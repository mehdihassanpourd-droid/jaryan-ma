// The sweeper. It is deliberately independent of the deploy run: it keeps no state, finds everything by NAME PREFIX
// (jm-probe-) and deletes what is expired (or everything of ours with force). It retries, re-lists afterwards to see what is
// still there, and reports honestly. It does NOT claim success it did not observe: ok is true only when a final listing of
// every resource type succeeded AND showed nothing of ours left to delete.
import { KINDS } from "./arvan.mjs";
import { isExpired, parseName } from "./cost.mjs";

async function scan(client, region, kinds) {
  const found = [];
  const listErrors = [];
  for (const kind of kinds) {
    try {
      for (const r of await client.list(region, kind)) found.push({ kind, id: r.id, name: r.name });
    } catch (e) {
      listErrors.push({ kind, error: e.message });
    }
  }
  return { found, listErrors };
}

export async function sweep({ client, region, now = Date.now(), force = false, attempts = 4, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), kinds = KINDS }) {
  const report = { region, force, deleted: [], deleteErrors: [], active: [], leftover: [], listErrors: [], attempts: 0, ok: false };
  const due = (x) => parseName(x.name).ours && (force || isExpired(x.name, now));
  const order = (x) => kinds.indexOf(x.kind);
  const gone = new Set();

  for (let pass = 1; pass <= attempts; pass++) {
    report.attempts = pass;
    const { found, listErrors } = await scan(client, region, kinds);
    report.listErrors = listErrors;
    const todo = found.filter(due).sort((a, b) => order(a) - order(b));
    if (todo.length === 0 && listErrors.length === 0) break;
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
  for (const x of report.deleteErrors.slice(-5)) lines.push(`  delete error: ${x.kind} ${x.name}: ${x.error}`);
  if (!report.ok) lines.push("ACTION: this is NOT confirmed clean. Open the ArvanCloud panel and delete every resource whose name starts with jm-probe-.");
  return lines.join("\n");
}
