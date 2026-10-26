import { z } from "zod";
import { fixPersianLetters } from "../persian";

export const INCIDENT_SEVERITIES = ["minor", "major", "critical"] as const;
export const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export const INCIDENT_SOURCES = ["manual", "health_check", "deployment", "security", "backup"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

const text = (min: number, max: number) => z.string().trim().min(min).max(max).transform(fixPersianLetters);

export const incidentCreateSchema = z
  .object({
    title: text(3, 140),
    severity: z.enum(INCIDENT_SEVERITIES),
    source: z.enum(INCIDENT_SOURCES).default("manual"),
    summary: z.string().trim().max(2000).transform(fixPersianLetters).default(""),
    /** When the problem began (defaults to now). Not allowed in the future. */
    startedAt: z.coerce.date().optional(),
  })
  .strict();
export type IncidentCreate = z.output<typeof incidentCreateSchema>;

export const incidentUpdateSchema = z
  .object({
    status: z.enum(INCIDENT_STATUSES).optional(),
    severity: z.enum(INCIDENT_SEVERITIES).optional(),
    message: text(1, 2000),
  })
  .strict();
export type IncidentUpdate = z.output<typeof incidentUpdateSchema>;

const FORWARD: Record<IncidentStatus, readonly IncidentStatus[]> = {
  investigating: ["identified", "monitoring", "resolved"],
  identified: ["investigating", "monitoring", "resolved"],
  monitoring: ["investigating", "identified", "resolved"],
  resolved: ["investigating"],
};

export function canIncidentTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return from !== to && FORWARD[from].includes(to);
}
