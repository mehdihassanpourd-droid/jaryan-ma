/**
 * Pluggable SMS delivery. The application only ever depends on this interface. No paid SMS service is
 * activated by default: the production default is "none" and customer sign-in stays disabled until the owner
 * chooses a provider and configures it.
 */
export interface SmsMessage {
  /** E.164, e.g. +989121234567 */
  to: string;
  text: string;
}

export interface SmsResult {
  providerMessageId: string | null;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsResult>;
}

export class SmsNotConfiguredError extends Error {
  constructor() {
    super("sms_not_configured");
    this.name = "SmsNotConfiguredError";
  }
}

export class SmsDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsDeliveryError";
  }
}

/** The safe default: sending is impossible, so sign-in cannot silently "work" without a real provider. */
export class DisabledSmsProvider implements SmsProvider {
  readonly name = "none";
  async send(): Promise<SmsResult> {
    throw new SmsNotConfiguredError();
  }
}

/** Test double that records messages. */
export class MemorySmsProvider implements SmsProvider {
  readonly name = "memory";
  readonly sent: SmsMessage[] = [];
  failNext: Error | null = null;

  async send(message: SmsMessage): Promise<SmsResult> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    this.sent.push(message);
    return { providerMessageId: `mem-${this.sent.length}` };
  }

  /** The 6-digit code in the latest message to a number, for tests. */
  lastCode(to: string): string | undefined {
    const message = [...this.sent].reverse().find((m) => m.to === to);
    return message ? /(\d{6})/.exec(message.text)?.[1] : undefined;
  }
}

/** Development helper: prints the message (including the code) to the server log. NEVER allowed in production. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  constructor(private readonly print: (line: string) => void = console.log) {}
  async send(message: SmsMessage): Promise<SmsResult> {
    this.print(`[dev sms] to ${message.to}: ${message.text.replace(/\n/g, " ")}`);
    return { providerMessageId: null };
  }
}

export interface HttpSmsSettings {
  /** HTTPS endpoint of the gateway (plain http only for localhost). */
  url: string;
  /** Extra headers, e.g. { Authorization: "Bearer ..." }. Secrets come from the environment, never the code. */
  headers: Record<string, string>;
  /** JSON body with {{to}} and {{text}} placeholders; values are JSON-escaped, so they cannot break out of the string. */
  bodyTemplate: string;
  /** Dot path of the message id in the JSON response (optional). */
  idField?: string;
  timeoutMs?: number;
}

const escapeForJson = (value: string) => JSON.stringify(value).slice(1, -1);

/**
 * Generic JSON-over-HTTPS gateway adapter, so any provider with a simple HTTP API can be used without code
 * changes. Verified only against a fake server in tests; it has NOT been tried with a real SMS gateway.
 */
export class HttpSmsProvider implements SmsProvider {
  readonly name = "http";

  constructor(
    private readonly settings: HttpSmsSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const url = new URL(settings.url);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local) throw new Error("sms_http_requires_https");
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    const body = this.settings.bodyTemplate.replace(/\{\{to\}\}/g, escapeForJson(message.to)).replace(/\{\{text\}\}/g, escapeForJson(message.text));
    let response: Response;
    try {
      response = await this.fetchImpl(this.settings.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.settings.headers },
        body,
        signal: AbortSignal.timeout(this.settings.timeoutMs ?? 8000),
      });
    } catch {
      throw new SmsDeliveryError("sms_gateway_unreachable");
    }
    if (!response.ok) throw new SmsDeliveryError(`sms_gateway_status_${response.status}`);
    let id: string | null = null;
    if (this.settings.idField) {
      try {
        let node: unknown = await response.json();
        for (const key of this.settings.idField.split(".")) node = (node as Record<string, unknown> | null)?.[key];
        if (typeof node === "string" || typeof node === "number") id = String(node);
      } catch {
        id = null;
      }
    }
    return { providerMessageId: id };
  }
}
