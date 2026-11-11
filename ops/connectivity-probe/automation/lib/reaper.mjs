// The sweeper. It is deliberately independent of the deploy run: it keeps no state, finds everything by NAME PREFIX
// (jm-probe-) and deletes what is expired (or everything of ours with force). It retries, re-lists afterwards to see what is
// still there, and reports honestly. It does NOT claim success it did not observe: ok is true only when a final listing of
// every resource type succeeded AND showed nothing of ours left to delete.
import { KINDS, OPTIONAL_KINDS } from "./arvan.mjs";
import { isExpired, parseName } from "./cost.mjs";

// A listing that fails is classified, never ignored:
//   - a REQUIRED kind (server, disk, snapshot) that cannot be listed is a failure: unknown is never reported as clean
//   - an OPTIONAL kind (floating IP, SSH key) refused with 403/404 is "not checked": the API does not offer it to this key. It is
//     reported on every run and never hidden, but it is not an error, because this tool never creates that kind of resource.
//   - anything else (timeouts, 5xx, 429, a bad answer) is a failure, and is retried
async function scan(client, region, kinds) {
  const found = [];
  const listErrors = [];
  const unverified = [];
  for (const kind of kinds) {
    try {
      for (const r of await client.list(region, kind)) found.push({ kind, id: r.id, name: r.name });
    } catch (e) {
      if (OPTIONAL_KINDS.has(kind) && (e.status === 403 || e.status === 404)) unverified.push({ kind, status: e.status });
      else listErrors.push({ kind, error: e.message, status: e.status ?? 0, retryable: e.retryable === true });
    }
  }
  return { found, listErrors, unverified };
}

export async function sweep({ client, region, now = Date.now(), force = false, attempts = 4, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), kinds = KINDS }) {
  const report = { region, force, deleted: [], deleteErrors: [], active: [], leftover: [], listErrors: [], unverified: [], attempts: 0, ok: false };
  const due = (x) => parseName(x.name).ours && (force || isExpired(x.name, now));
  const order = (x) => kinds.indexOf(x.kind);
  const gone = new Set();

  for (let pass = 1; pass <= attempts; pass++) {
    report.attempts = pass;
    const { found, listErrors, unverified } = await scan(client, region, kinds);
    report.listErrors = listErrors;
    report.unverified = unverified;
    const todo = found.filter(due).sort((a, b) => order(a) - order(b));
    // nothing to delete and nothing worth retrying (a refused or missing endpoint will answer the same way again): stop at once
    if (todo.length === 0 && !listErrors.some((x) => x.retryable)) break;
    for (const x of todo) {
      try {
        await client.remove(region, x.kind, x.id);
        if (!gone.has(`${x.kind}:${x.id}`)) report.deleted.push(x);
        gone.add(`${x.kind}:${x.id}`);
      } catch (e) {
        report.deleteErrors.push({ ...x, error: e.message });
      }
    }
    if (pass < attempts) await sleep(Math.min(60000, 2000 * 2 ** (pass - 1)));
  }

  const final = await scan(client, region, kinds);
  report.listErrors = final.listErrors;
  report.unverified = final.unverified;
  report.leftover = final.found.filter(due);
  report.active = final.found.filter((x) => parseName(x.name).ours && !due(x));
  report.ok = report.listErrors.length === 0 && report.leftover.length === 0;
  return report;
}

export function describe(report) {
  const lines = [`sweep ${report.ok ? "OK" : "NOT CLEAN"} in region ${report.region} after ${report.attempts} pass(es)${report.force ? " (forced)" : ""}`];
  lines.push(`deleted: ${report.deleted.length}, still active (not yet due): ${report.active.length}, left over: ${report.leftover.length}`);
  for (const x of report.leftover) lines.push(`  LEFT OVER: ${x.kind} ${x.name} (${x.id})`);
  for (const x of report.listErrors) lines.push(`  COULD NOT LIST ${x.kind}: ${x.error}`);
  for (const x of report.unverified ?? []) lines.push(`  NOT CHECKED (not an error): ${x.kind} cannot be listed with this key (HTTP ${x.status}); this tool never creates that kind of resource`);
  for (const x of report.deleteErrors.slice(-5)) lines.push(`  delete error: ${x.kind} ${x.name}: ${x.error}`);
  if (!report.ok) lines.push("ACTION: this is NOT confirmed clean. Open the ArvanCloud panel and delete every resource whose name starts with jm-probe-.");
  return lines.join("\n");
}
