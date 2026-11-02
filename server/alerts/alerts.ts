import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { redactSensitive } from "../../src/domain/maintenance/error-report";
import { redactLogValue } from "../observability/logger";

/**
 * Modular alerting. The application raises an `Alert` through the `AlertPublisher` port; WHERE it goes is decided by the
 * sinks registered at start-up. Today's sinks are local (stdout JSON line, append-only file); an e-mail, SMS, Telegram-
 * compatible or monitoring-system sink is one more class implementing `AlertSink`. Nothing is sent anywhere unless the
 * operator configures it (see `alertSinksFromEnv`), no sink needs a paid service, and a failing sink can never break the
 * request or job that raised the alert.
 *
 * Priority scale (matches docs/maintenance/INCIDENT-RESPONSE-FA.md): P0 store down / data at risk, P1 major function broken,
 * P2 degraded, P3 informational.
 */
export type AlertPriority = "P0" | "P1" | "P2" | "P3";
export const PRIORITY_RANK: Record<AlertPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export interface Alert {
  priority: AlertPriority;
  /** Stable machine key used for de-duplication, e.g. "health.database". */
  key: string;
  title: string;
  /** Short description. Redacted before it reaches any sink; still never put personal data here. */
  message: string;
  /** "firing" while the problem exists, "resolved" when it is over. */
  state?: "firing" | "resolved";
  source?: string;
  fields?: Record<string, unknown>;
}

export interface DeliveredAlert extends Alert {
  state: "firing" | "resolved";
  at: string;
}

export interface AlertSink {
  readonly name: string;
  /** Only alerts at least this urgent are delivered (default "P3": everything). */
  readonly minPriority?: AlertPriority;
  deliver(alert: DeliveredAlert): Promise<void>;
}

/** What application code depends on. */
export interface AlertPublisher {
  notify(alert: Alert): Promise<void>;
}

export const noAlerts: AlertPublisher = { notify: async () => undefined };

export interface AlertManagerOptions {
  /** The same key+state is delivered at most once in this window (default 15 minutes); "resolved" always passes once after "firing". */
  dedupeMs?: number;
  now?: () => Date;
  onSinkError?: (sink: string, error: unknown) => void;
}

export class AlertManager implements AlertPublisher {
  private readonly last = new Map<string, { state: string; at: number }>();
  private readonly now: () => Date;
  private readonly dedupeMs: number;

  constructor(private readonly sinks: readonly AlertSink[], private readonly options: AlertManagerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.dedupeMs = options.dedupeMs ?? 15 * 60_000;
  }

  async notify(alert: Alert): Promise<void> {
    const at = this.now();
    const state = alert.state ?? "firing";
    const previous = this.last.get(alert.key);
    if (previous && previous.state === state && at.getTime() - previous.at < this.dedupeMs) return;
    // A resolution is only worth sending for something that fired.
    if (state === "resolved" && !previous) return;
    this.last.set(alert.key, { state, at: at.getTime() });
    const text = (value: string, max: number) => redactSensitive(value).slice(0, max);
    const delivered: DeliveredAlert = {
      priority: alert.priority,
      key: text(alert.key, 80),
      title: text(alert.title, 120),
      message: text(alert.message, 500),
      state,
      at: at.toISOString(),
      ...(alert.source ? { source: text(alert.source, 60) } : {}),
      ...(alert.fields ? { fields: redactLogValue(alert.fields) as Record<string, unknown> } : {}),
    };
    await Promise.all(
      this.sinks
        .filter((s) => PRIORITY_RANK[alert.priority] <= PRIORITY_RANK[s.minPriority ?? "P3"])
        .map(async (sink) => {
          try {
            await sink.deliver(delivered);
          } catch (error) {
            try {
              this.options.onSinkError?.(sink.name, error);
            } catch {
              /* reporting a sink failure must not throw either */
            }
          }
        }),
    );
  }
}

// ---- sinks ---------------------------------------------------------------------------------------------

/** One JSON line per alert on the process output (collected by journald / the container runtime). */
export class ConsoleAlertSink implements AlertSink {
  readonly name = "console";
  constructor(readonly minPriority: AlertPriority = "P3", private readonly write: (line: string) => void = (l) => console.log(l)) {}
  async deliver(alert: DeliveredAlert): Promise<void> {
    this.write(JSON.stringify({ event: "alert", ...alert }));
  }
}

/** Appends one JSON line per alert to a local file (watch it with `tail -f`, ship it with any log agent). */
export class FileAlertSink implements AlertSink {
  readonly name = "file";
  constructor(private readonly path: string, readonly minPriority: AlertPriority = "P3") {}
  async deliver(alert: DeliveredAlert): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await appendFile(this.path, `${JSON.stringify(alert)}\n`, { mode: 0o600 });
  }
}

/**
 * OPTIONAL generic webhook (POSTs the alert as JSON to an address the operator chose, e.g. a self-hosted notifier inside the
 * same network). Off unless ALERT_WEBHOOK_URL is set. https is required except for loopback/private-range hosts; a short
 * timeout keeps a dead endpoint from holding anything up.
 */
export class WebhookAlertSink implements AlertSink {
  readonly name = "webhook";
  constructor(private readonly url: string, readonly minPriority: AlertPriority = "P1", private readonly fetchImpl: typeof fetch = fetch, private readonly timeoutMs = 5000) {
    assertWebhookUrl(url);
  }
  async deliver(alert: DeliveredAlert): Promise<void> {
    const response = await this.fetchImpl(this.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(alert), signal: AbortSignal.timeout(this.timeoutMs), redirect: "error" });
    if (!response.ok) throw new Error(`webhook_status_${response.status}`);
  }
}

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
export function assertWebhookUrl(raw: string): void {
  const url = new URL(raw);
  if (url.username || url.password) throw new Error("alert_webhook_credentials_in_url");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && PRIVATE_HOST.test(url.hostname))) throw new Error("alert_webhook_requires_https");
}

/**
 * ALERT_SINKS = comma list of `console`, `file`, `webhook` (default `console`).
 * ALERT_FILE (default ./logs/alerts.jsonl), ALERT_WEBHOOK_URL, ALERT_MIN_PRIORITY_WEBHOOK (default P1).
 */
export function alertSinksFromEnv(env: Record<string, string | undefined>, write?: (line: string) => void): AlertSink[] {
  const wanted = (env.ALERT_SINKS ?? "console").split(",").map((s) => s.trim()).filter(Boolean);
  const priority = (value: string | undefined, fallback: AlertPriority): AlertPriority => (value === "P0" || value === "P1" || value === "P2" || value === "P3" ? value : fallback);
  const sinks: AlertSink[] = [];
  for (const name of new Set(wanted)) {
    if (name === "console") sinks.push(new ConsoleAlertSink("P3", write));
    else if (name === "file") sinks.push(new FileAlertSink(env.ALERT_FILE ?? "logs/alerts.jsonl"));
    else if (name === "webhook") {
      if (!env.ALERT_WEBHOOK_URL) throw new Error("ALERT_WEBHOOK_URL is required when ALERT_SINKS includes webhook");
      sinks.push(new WebhookAlertSink(env.ALERT_WEBHOOK_URL, priority(env.ALERT_MIN_PRIORITY_WEBHOOK, "P1")));
    } else throw new Error(`unknown alert sink "${name}" (use console, file, webhook)`);
  }
  return sinks;
}

/** Incident severity (maintenance) to alert priority. */
export const priorityForSeverity = (severity: "minor" | "major" | "critical"): AlertPriority => (severity === "critical" ? "P0" : severity === "major" ? "P1" : "P2");
