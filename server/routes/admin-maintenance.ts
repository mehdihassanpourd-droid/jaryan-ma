import { z } from "zod";
import { incidentCreateSchema, incidentUpdateSchema } from "../../src/domain/maintenance/incident";
import type { AdminRouter } from "../api";
import { errorResponse, json } from "../http";
import type { MaintenanceService } from "../maintenance/service";
import { parseBody, parseQuery } from "./common";

const backupSchema = z
  .object({
    kind: z.enum(["database", "media"]),
    takenAt: z.coerce.date(),
    sizeBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    location: z.string().trim().min(1).max(300),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
    encrypted: z.boolean(),
  })
  .strict();
const restoreTestSchema = z.object({ ok: z.boolean(), notes: z.string().max(1000).nullable().optional() }).strict();
const listSchema = z.object({ open: z.enum(["true", "false"]).optional(), resolved: z.enum(["true", "false"]).optional(), kind: z.enum(["database", "media"]).default("database"), action: z.string().max(80).optional() });

/** Maintenance endpoints. Permission checks live in MaintenanceService. */
export function createMaintenanceAdminRoutes(maintenance: MaintenanceService): AdminRouter {
  return async ({ request, url, method, path, principal }) => {
    if (!path.startsWith("/maintenance/")) return null;
    const op = { email: principal.email, role: principal.role };
    const sub = path.slice("/maintenance".length);
    const q = parseQuery(url.searchParams, listSchema);
    if (!q.ok) return q.response;
    const flag = (v: string | undefined) => (v === undefined ? undefined : v === "true");

    if (sub === "/health" && method === "GET") {
      return json(await maintenance.healthFor(op));
    }
    if (sub === "/backup-status" && method === "GET") {
      return json(await maintenance.backupStatusFor(op));
    }
    if (sub === "/incidents" && method === "GET") return json({ incidents: await maintenance.listIncidents(op, { open: flag(q.data.open) }) });
    if (sub === "/incidents" && method === "POST") {
      const body = await parseBody(request, incidentCreateSchema);
      if (!body.ok) return body.response;
      return json({ incident: await maintenance.createIncident(op, body.data) }, 201);
    }
    const incident = /^\/incidents\/(\d{1,10})(\/updates)?$/.exec(sub);
    if (incident) {
      const number = Number(incident[1]);
      if (!incident[2] && method === "GET") return json({ incident: await maintenance.getIncident(op, number) });
      if (incident[2] && method === "POST") {
        const body = await parseBody(request, incidentUpdateSchema);
        if (!body.ok) return body.response;
        await maintenance.updateIncident(op, number, body.data);
        return json({ ok: true }, 201);
      }
      return errorResponse("method_not_allowed", 405);
    }

    if (sub === "/backups" && method === "GET") return json({ backups: await maintenance.listBackups(op, q.data.kind) });
    if (sub === "/backups" && method === "POST") {
      const body = await parseBody(request, backupSchema);
      if (!body.ok) return body.response;
      return json({ backup: await maintenance.recordBackup(op, body.data) }, 201);
    }
    const restore = /^\/backups\/([0-9a-f-]{36})\/restore-test$/.exec(sub);
    if (restore && method === "POST") {
      const body = await parseBody(request, restoreTestSchema);
      if (!body.ok) return body.response;
      await maintenance.recordRestoreTest(op, restore[1] as string, body.data.ok, body.data.notes ?? null);
      return json({ ok: true, backupStatus: await maintenance.backupStatus() }, 201);
    }

    if (sub === "/errors" && method === "GET") return json({ errors: await maintenance.listErrors(op, { resolved: flag(q.data.resolved) }) });
    const err = /^\/errors\/([0-9a-f-]{36})\/resolve$/.exec(sub);
    if (err && method === "POST") {
      await maintenance.resolveError(op, err[1] as string);
      return json({ ok: true });
    }
    if (sub === "/log" && method === "GET") return json({ log: await maintenance.listLog(op, { action: q.data.action }) });
    return null;
  };
}
