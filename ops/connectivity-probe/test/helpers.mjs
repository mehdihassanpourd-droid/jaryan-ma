// Test helpers: start a REAL nginx with the rendered probe configuration on high ports, with a throw-away self-signed certificate.
// Nothing here touches the Jaryan Ma application; the probe package is tested on its own.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DOMAIN = "jm.test";
export const HOSTS = { page: `probe.${DOMAIN}`, api: `probe-api.${DOMAIN}`, pay: `probe-pay.${DOMAIN}` };

export const haveNginx = (() => {
  const r = spawnSync("nginx", ["-v"], { encoding: "utf8" });
  return r.status === 0 || String(r.stderr).includes("nginx/");
})();
export const haveOpenssl = spawnSync("openssl", ["version"]).status === 0;

export function freePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

export function makeCert(dir, names = Object.values(HOSTS)) {
  const san = names.map((n) => `DNS:${n}`).join(",");
  const r = spawnSync("openssl", ["req", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", "2", "-subj", `/CN=${names[0]}`, "-addext", `subjectAltName=${san}`, "-keyout", join(dir, "privkey.pem"), "-out", join(dir, "fullchain.pem")], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`openssl failed: ${r.stderr}`);
}

/** Renders the template (through the real render.sh) and starts nginx. Returns { httpPort, httpsPort, dir, logDir, stop(), conf }. */
export async function startProbe({ renderArgs = [], extraHttp = "" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jm-probe-test-"));
  chmodSync(dir, 0o755);
  // an isolated copy: the package must work without anything else from the repository
  const pkg = join(dir, "pkg");
  cpSync(join(PKG, "web"), join(pkg, "web"), { recursive: true });
  cpSync(join(PKG, "nginx"), join(pkg, "nginx"), { recursive: true });
  cpSync(join(PKG, "scripts"), join(pkg, "scripts"), { recursive: true });
  const logDir = join(dir, "logs");
  const certDir = join(dir, "cert");
  const acme = join(dir, "acme");
  for (const d of [logDir, certDir, acme, join(dir, "tmp")]) mkdirSync(d, { recursive: true, mode: 0o777 });
  chmodSync(logDir, 0o777);
  makeCert(certDir);
  const httpPort = await freePort();
  const httpsPort = await freePort();
  const conf = join(dir, "probe.conf");
  const r = spawnSync("bash", [join(pkg, "scripts/render.sh"), "--domain", DOMAIN, "--cert-dir", certDir, "--web-root", join(pkg, "web"), "--log-dir", logDir, "--acme-root", acme, "--http-port", String(httpPort), "--https-port", String(httpsPort), "--out", conf, ...renderArgs], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`render.sh failed: ${r.stderr}`);
  const main = join(dir, "nginx.conf");
  const tmp = join(dir, "tmp");
  writeFileSync(main, `worker_processes 1;\npid ${dir}/nginx.pid;\nerror_log ${dir}/error.log crit;\nevents { worker_connections 256; }\nhttp {\n  default_type application/octet-stream;\n  types { text/html html; text/css css; application/javascript js; application/json json; image/png png; }\n  client_body_temp_path ${tmp}/body; proxy_temp_path ${tmp}/proxy; fastcgi_temp_path ${tmp}/fcgi; uwsgi_temp_path ${tmp}/uwsgi; scgi_temp_path ${tmp}/scgi;\n${extraHttp}\n  include ${conf};\n}\n`);
  spawnSync("chmod", ["-R", "a+rwX", dir]);
  const check = spawnSync("nginx", ["-t", "-p", dir, "-c", main], { encoding: "utf8" });
  if (check.status !== 0) throw new Error(`nginx -t failed:\n${check.stderr}`);
  const proc = spawn("nginx", ["-p", dir, "-c", main, "-g", "daemon off;"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try {
      await httpGet(httpPort, "/", { host: HOSTS.page });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (i === 59) throw new Error(`nginx did not start: ${existsSync(join(dir, "error.log")) ? readFileSync(join(dir, "error.log"), "utf8") : ""}`);
  }
  return {
    dir, logDir, certDir, httpPort, httpsPort, conf, main,
    accessLog: () => (existsSync(join(logDir, "jm-probe-access.log")) ? readFileSync(join(logDir, "jm-probe-access.log"), "utf8") : ""),
    reportLog: () => (existsSync(join(logDir, "jm-probe-report.log")) ? readFileSync(join(logDir, "jm-probe-report.log"), "utf8") : ""),
    errorLog: () => (existsSync(join(dir, "error.log")) ? readFileSync(join(dir, "error.log"), "utf8") : ""),
    async stop() {
      proc.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 300));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function collect(res, resolve) {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
}

export function httpGet(port, path, { host, method = "GET", headers = {}, localAddress } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, localAddress, headers: { host, ...headers } }, (res) => collect(res, resolve));
    req.on("error", reject);
    req.end();
  });
}

/** HTTPS request to the local nginx with the given virtual host (certificate check off: self-signed). */
export function httpsCall(port, host, path, { method = "GET", headers = {}, body, localAddress, minVersion, maxVersion } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({ host: "127.0.0.1", port, path, method, servername: host, rejectUnauthorized: false, localAddress, minVersion, maxVersion, headers: { host: `${host}:${port}`, ...(body !== undefined ? { "content-length": String(Buffer.byteLength(body)) } : {}), ...headers } }, (res) => collect(res, resolve));
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
