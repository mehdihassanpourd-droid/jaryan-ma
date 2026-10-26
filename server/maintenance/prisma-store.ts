import type { Prisma } from "../../src/generated/prisma/client";
import type { Db } from "../db/client";
import type { BackupRow, ErrorReportRow, IncidentRow, MaintenanceLogRow, MaintenanceStore } from "./ports";

const TX = { timeout: 30_000, maxWait: 10_000 };

const toIncident = (i: Prisma.IncidentGetPayload<object>): IncidentRow => ({
  id: i.id, number: i.number, title: i.title, severity: i.severity, status: i.status, source: i.source, summary: i.summary, startedAt: i.startedAt, resolvedAt: i.resolvedAt, createdBy: i.createdBy,
});

const toBackup = (b: Prisma.BackupRecordGetPayload<object>): BackupRow => ({
  id: b.id, kind: b.kind, takenAt: b.takenAt, sizeBytes: Number(b.sizeBytes), location: b.location, sha256: b.sha256, encrypted: b.encrypted, recordedBy: b.recordedBy,
  restoreTestedAt: b.restoreTestedAt, restoreTestOk: b.restoreTestOk, restoreTestNotes: b.restoreTestNotes,
});

const toError = (e: Prisma.ErrorReportGetPayload<object>): ErrorReportRow => ({
  id: e.id, fingerprint: e.fingerprint, source: e.source, environment: e.environment, release: e.release, name: e.name, message: e.message, stack: e.stack, url: e.url,
  count: e.count, firstSeenAt: e.firstSeenAt, lastSeenAt: e.lastSeenAt, resolved: e.resolved,
});

export class PrismaMaintenanceStore implements MaintenanceStore {
  constructor(private readonly db: Db) {}

  async createIncident(data: Parameters<MaintenanceStore["createIncident"]>[0], now: Date) {
    const row = await this.db.incident.create({
      data: {
        title: data.title, severity: data.severity, source: data.source, summary: data.summary, startedAt: data.startedAt, createdBy: data.createdBy, createdAt: now, updatedAt: now,
        updates: { create: { at: now, author: data.createdBy, status: "investigating", message: data.summary || data.title } },
      },
    });
    return toIncident(row);
  }

  async listIncidents(filter: { open?: boolean }, limit: number) {
    const rows = await this.db.incident.findMany({
      where: filter.open === undefined ? {} : filter.open ? { status: { not: "resolved" } } : { status: "resolved" },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
    return rows.map(toIncident);
  }

  async getIncident(number: number) {
    const row = await this.db.incident.findUnique({ where: { number }, include: { updates: { orderBy: { at: "asc" } } } });
    return row ? { ...toIncident(row), updates: row.updates.map((u) => ({ at: u.at, author: u.author, status: u.status, message: u.message })) } : null;
  }

  async updateIncident(number: number, patch: Parameters<MaintenanceStore["updateIncident"]>[1], now: Date) {
    return this.db.$transaction(async (tx) => {
      const current = await tx.incident.findUnique({ where: { number }, select: { id: true } });
      if (!current) return false;
      await tx.incidentUpdate.create({ data: { incidentId: current.id, at: now, author: patch.author, status: patch.status ?? null, message: patch.message } });
      await tx.incident.update({
        where: { id: current.id },
        data: {
          ...(patch.severity ? { severity: patch.severity } : {}),
          ...(patch.status ? { status: patch.status, resolvedAt: patch.status === "resolved" ? now : null } : {}),
          updatedAt: now,
        },
      });
      return true;
    }, TX);
  }

  async findOpenIncident(source: Parameters<MaintenanceStore["findOpenIncident"]>[0]) {
    const row = await this.db.incident.findFirst({ where: { source, status: { not: "resolved" } }, orderBy: { startedAt: "desc" } });
    return row ? toIncident(row) : null;
  }

  async recordBackup(data: Parameters<MaintenanceStore["recordBackup"]>[0], now: Date) {
    return toBackup(await this.db.backupRecord.create({ data: { ...data, sizeBytes: BigInt(data.sizeBytes), createdAt: now } }));
  }

  async recordRestoreTest(id: string, ok: boolean, notes: string | null, testedAt: Date) {
    const r = await this.db.backupRecord.updateMany({ where: { id }, data: { restoreTestedAt: testedAt, restoreTestOk: ok, restoreTestNotes: notes } });
    return r.count === 1;
  }

  async listBackups(kind: "database" | "media", limit: number) {
    return (await this.db.backupRecord.findMany({ where: { kind }, orderBy: { takenAt: "desc" }, take: limit })).map(toBackup);
  }

  async backupFacts(kind: "database" | "media") {
    const rows = await this.db.backupRecord.findMany({ where: { kind }, orderBy: { takenAt: "desc" }, take: 200 });
    return rows.map((r) => ({ takenAt: r.takenAt, restoreTestedAt: r.restoreTestedAt, restoreTestOk: r.restoreTestOk, encrypted: r.encrypted }));
  }

  async upsertError(data: Parameters<MaintenanceStore["upsertError"]>[0], now: Date) {
    const row = await this.db.errorReport.upsert({
      where: { fingerprint: data.fingerprint },
      // A recurrence of a resolved error reopens it.
      update: { count: { increment: 1 }, lastSeenAt: now, resolved: false, release: data.release },
      create: { ...data, firstSeenAt: now, lastSeenAt: now },
    });
    return toError(row);
  }

  async listErrors(filter: { resolved?: boolean }, limit: number) {
    return (await this.db.errorReport.findMany({ where: filter.resolved === undefined ? {} : { resolved: filter.resolved }, orderBy: { lastSeenAt: "desc" }, take: limit })).map(toError);
  }

  async resolveError(id: string) {
    return (await this.db.errorReport.updateMany({ where: { id }, data: { resolved: true } })).count === 1;
  }

  countErrorsSince(since: Date) {
    return this.db.errorReport.count({ where: { lastSeenAt: { gte: since }, resolved: false } });
  }

  async log(entry: Parameters<MaintenanceStore["log"]>[0], at: Date) {
    await this.db.maintenanceLog.create({ data: { actor: entry.actor, action: entry.action, target: entry.target, outcome: entry.outcome, detail: entry.detail as Prisma.InputJsonValue, at } });
  }

  async listLog(filter: { action?: string }, limit: number): Promise<MaintenanceLogRow[]> {
    const rows = await this.db.maintenanceLog.findMany({ where: filter.action ? { action: filter.action } : {}, orderBy: { at: "desc" }, take: limit });
    return rows.map((r) => ({ id: r.id, at: r.at, actor: r.actor, action: r.action, target: r.target, outcome: r.outcome as "success" | "failure", detail: r.detail }));
  }

  async prune(opts: { resolvedErrorsBefore: Date; logBefore: Date }) {
    const [errors, log] = await Promise.all([
      this.db.errorReport.deleteMany({ where: { resolved: true, lastSeenAt: { lt: opts.resolvedErrorsBefore } } }),
      this.db.maintenanceLog.deleteMany({ where: { at: { lt: opts.logBefore } } }),
    ]);
    return { errors: errors.count, log: log.count };
  }
}
