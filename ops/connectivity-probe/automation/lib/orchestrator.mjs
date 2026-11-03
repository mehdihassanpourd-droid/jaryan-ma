import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KINDS } from "./arvan.mjs";
import { buildUserData } from "./cloudinit.mjs";
import { costCeiling, estimateCost, makeName, parseName, validatePlan } from "./cost.mjs";
import { sweep } from "./reaper.mjs";
import { deriveIdentity } from "./sshkey.mjs";
import { parseReportLog, summarize, format } from "../../scripts/summarize.mjs";

const DOMAIN_RE = /^(?=.{4,100}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));
export const hosts = (domain) => [`probe.${domain}`, `probe-api.${domain}`, `probe-pay.${domain}`];

// ---- tolerant readers for fields whose exact names are UNVERIFIED --------------------------------------------------------
const num = (...v) => v.map(Number).find((n) => Number.isFinite(n));
export function pickFlavor(list) {
  const ok = list.filter((f) => {
    const cpu = num(f.vcpus, f.vcpu, f.cpu, f.cpus);
    let ram = num(f.memory, f.ram, f.memory_size, f.memory_mb);
    if (ram !== undefined && ram <= 64) ram *= 1024;
    const disk = num(f.disk, f.disk_size, f.root_disk, f.storage);
    return cpu === 1 && ram >= 900 && ram <= 1100 && disk >= 20 && disk <= 30;
  });
  if (ok.length !== 1) throw new Error(`could not pick exactly one 1 vCPU / 1 GB / 25 GB flavor (found ${ok.length} of ${list.length}); run the dry-run and look at the sizes`);
  return ok[0];
}
export function pickImage(list) {
  const ok = list.filter((i) => /ubuntu/i.test(i.name ?? "") && /24\.04/.test(`${i.name} ${i.version ?? ""}`));
  if (ok.length < 1) throw new Error(`no Ubuntu 24.04 image found among ${list.length} images`);
  return ok[0];
}
export const findIpv4 = (server) => JSON.stringify(server.addresses ?? server.ips ?? server.ip ?? server.floating_ip ?? "").match(/\b(?!10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}(?:\.\d{1,3}){3}\b/)?.[0] ?? null;

// ---- dry run: READ ONLY -------------------------------------------------------------------------------------------------
export async function dryRun({ client, region }) {
  const out = { action: "dry-run", ok: true, region, checks: [] };
  const check = async (name, fn) => {
    try {
      out.checks.push({ name, ok: true, detail: await fn() });
    } catch (e) {
      out.ok = false;
      out.checks.push({ name, ok: false, detail: e.message });
    }
  };
  await check("regions", async () => `${(await client.regions()).length} region(s)`);
  for (const kind of KINDS) await check(`list ${kind}`, async () => `${(await client.list(region, kind)).length} existing`);
  await check("flavor 1 vCPU / 1 GB / 25 GB", async () => `selected ${pickFlavor(await client.list(region, "sizes")).id ?? "?"}`);
  await check("image Ubuntu 24.04", async () => `selected ${pickImage(await client.list(region, "images")).name}`);
  const mutating = client.log.calls.filter((c) => c.method !== "GET");
  if (mutating.length) throw new Error("dry-run attempted a non-read call");
  return out;
}

// ---- deploy ---------------------------------------------------------------------------------------------------------------
export async function deploy({ client, region, apiKey, plan, domain, certMode = "letsencrypt", dns = "none", remoteFactory, packageDir, now = Date.now(), runId, sleep = sleepDefault, resolveDns }) {
  const report = { action: "deploy", ok: false, region, domain, steps: [], ceilingIrr: 0 };
  const step = (name, detail = "") => report.steps.push({ name, detail, at: new Date().toISOString() });
  const errors = validatePlan(plan);
  if (errors.length) throw Object.assign(new Error(errors.join("; ")), { code: "invalid-input" });
  if (!region) throw Object.assign(new Error("region is required"), { code: "invalid-input" });
  if (!DOMAIN_RE.test(domain ?? "")) throw Object.assign(new Error("domain is not a valid domain name"), { code: "invalid-input" });
  if (!["letsencrypt", "selfsigned"].includes(certMode)) throw Object.assign(new Error("certMode must be letsencrypt or selfsigned"), { code: "invalid-input" });
  if (certMode === "letsencrypt" && dns === "none" && !resolveDns) throw Object.assign(new Error("letsencrypt needs DNS records to point at the server"), { code: "invalid-input" });

  // one trial at a time: refuse if anything of ours already exists
  for (const kind of KINDS) {
    const mine = (await client.list(region, kind)).filter((x) => parseName(x.name).ours);
    if (mine.length) throw Object.assign(new Error(`a probe resource already exists (${kind}: ${mine[0].name}); destroy it first`), { code: "exists" });
  }
  step("no earlier probe resources");

  const identity = deriveIdentity(apiKey);
  const expiresAt = now + plan.maxHours * 3600000;
  const name = makeName(runId, expiresAt);
  report.name = name;
  report.expiresAt = new Date(expiresAt).toISOString();
  report.ceilingIrr = costCeiling(plan);
  const flavor = pickFlavor(await client.list(region, "sizes"));
  const image = pickImage(await client.list(region, "images"));
  step("flavor and image selected", `${flavor.id} / ${image.name}`);

  let remote;
  try {
    const created = await client.create(region, "servers", {
      name, flavor_id: flavor.id, image_id: image.id, count: 1, init_script: buildUserData({ identity }), ssh_key: false,
    });
    const id = created.id ?? created.data?.id;
    step("server requested", String(id));

    let ip = null;
    for (let i = 0; i < 60 && !ip; i++) {
      const s = (await client.list(region, "servers")).find((x) => x.name === name);
      ip = s ? findIpv4(s) : null;
      if (!ip) await sleep(10000);
    }
    if (!ip) throw new Error("server got no public IPv4 address in time");
    report.ip = ip;
    step("public IPv4", ip);

    remote = remoteFactory({ ip, identity });
    await remote.waitReady();
    step("ssh with pinned host key works");

    if (certMode === "letsencrypt") {
      if (dns === "arvan") {
        for (const h of hosts(domain)) await client.dnsCreate(domain, { type: "A", name: h.slice(0, -domain.length - 1), value: [{ ip }], ttl: 120 });
        step("dns records created");
      }
      if (resolveDns) await resolveDns({ hosts: hosts(domain), ip });
      step("dns points to the server");
    }

    await remote.run("sudo DEBIAN_FRONTEND=noninteractive apt-get update -q && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q nginx openssl curl" + (certMode === "letsencrypt" ? " certbot" : ""));
    await remote.run("sudo systemctl stop nginx; sudo rm -f /etc/nginx/sites-enabled/default; sudo mkdir -p /opt/jm-probe /var/www/jm-probe/acme /etc/jm-probe/cert && sudo chown -R jmprobe /opt/jm-probe");
    step("packages installed");
    await remote.put(packageDir, "/opt/jm-probe");
    await remote.run("sudo rm -rf /var/www/jm-probe/web && sudo cp -r /opt/jm-probe/web /var/www/jm-probe/web");
    step("package uploaded");

    const h = hosts(domain);
    if (certMode === "letsencrypt") {
      await remote.run(`sudo certbot certonly --standalone --non-interactive --agree-tos --register-unsafely-without-email -d ${h.join(" -d ")} --cert-name jm-probe && sudo cp -L /etc/letsencrypt/live/jm-probe/fullchain.pem /etc/letsencrypt/live/jm-probe/privkey.pem /etc/jm-probe/cert/`);
    } else {
      const san = h.map((x) => `DNS:${x}`).join(",");
      await remote.run(`sudo openssl req -x509 -nodes -newkey rsa:2048 -days 3 -subj /CN=${h[0]} -addext subjectAltName=${san} -keyout /etc/jm-probe/cert/privkey.pem -out /etc/jm-probe/cert/fullchain.pem`);
    }
    step("certificate in place", certMode);
    await remote.run(`sudo bash /opt/jm-probe/scripts/render.sh --domain ${domain} --cert-dir /etc/jm-probe/cert --web-root /var/www/jm-probe/web --acme-root /var/www/jm-probe/acme --log-dir /var/log/nginx --out /etc/nginx/conf.d/jm-probe.conf && sudo nginx -t && sudo systemctl start nginx`);
    step("nginx configured and started");
    const insecure = certMode === "selfsigned" ? " --insecure" : "";
    const check = await remote.run(`bash /opt/jm-probe/scripts/self-check.sh --domain ${domain} --ip 127.0.0.1${insecure} 2>&1 | tail -30`);
    if (!/ALL CHECKS PASSED/.test(check)) throw new Error(`self-check on the server failed:\n${check.slice(-800)}`);
    step("self-check on the server passed");
    report.ok = true;
  } catch (e) {
    report.error = e.message;
    step("FAILED", e.message);
    report.cleanup = await sweep({ client, region, force: true, sleep, now });
    if (domain && dns === "arvan") await removeDns({ client, domain }).catch(() => {});
  } finally {
    remote?.close?.();
  }
  return report;
}

async function removeDns({ client, domain }) {
  const mine = hosts(domain).map((h) => h.slice(0, -domain.length - 1));
  for (const r of await client.dnsList(domain)) if (mine.includes(r.name)) await client.dnsRemove(domain, r.id);
}

// ---- collect ------------------------------------------------------------------------------------------------------------
export async function collect({ client, region, apiKey, remoteFactory, outDir, criteria }) {
  const server = (await client.list(region, "servers")).find((x) => parseName(x.name).ours);
  if (!server) return { action: "collect", ok: true, skipped: "no probe server exists" };
  const ip = findIpv4(server);
  const remote = remoteFactory({ ip, identity: deriveIdentity(apiKey) });
  try {
    await remote.waitReady({ timeoutMs: 60000, intervalMs: 5000 });
    const text = await remote.get("/var/log/nginx/jm-probe-report.log").catch(() => "");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "jm-probe-report.log"), text);
    const results = parseReportLog(text);
    const summary = summarize(results, criteria);
    writeFileSync(join(outDir, "summary.txt"), format(summary));
    return { action: "collect", ok: true, ip, lines: text.split("\n").filter(Boolean).length, results: results.length, decision: summary.decision };
  } finally {
    remote.close?.();
  }
}

// ---- destroy ------------------------------------------------------------------------------------------------------------
export async function destroy({ client, region, domain, dns = "none", plan, now = Date.now(), sleep }) {
  const before = await client.list(region, "servers").catch(() => []);
  const mine = before.find((x) => parseName(x.name).ours);
  const report = { action: "destroy", ...(await sweep({ client, region, force: true, now, sleep })) };
  if (dns === "arvan" && domain) {
    try {
      await removeDns({ client, domain });
    } catch (e) {
      report.ok = false;
      report.dnsError = e.message;
    }
  }
  if (mine && plan) report.estimatedCostIrr = estimateCost(plan, now - (parseName(mine.name).expiresAtMs - plan.maxHours * 3600000));
  return report;
}
