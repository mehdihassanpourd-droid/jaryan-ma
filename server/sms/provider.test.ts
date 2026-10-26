import { describe, expect, it } from "vitest";
import { ConsoleSmsProvider, DisabledSmsProvider, HttpSmsProvider, MemorySmsProvider, SmsDeliveryError, SmsNotConfiguredError } from "./provider";

const template = '{"receiver":"{{to}}","message":"{{text}}","sender":"JARYAN"}';

function fakeGateway(respond: (init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(init ?? {});
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("HttpSmsProvider (tested against a fake gateway only)", () => {
  it("posts JSON with the configured headers and returns the provider message id", async () => {
    const gw = fakeGateway(() => Response.json({ data: { id: 8841 } }));
    const sms = new HttpSmsProvider({ url: "https://sms.example.ir/send", headers: { authorization: "Bearer placeholder" }, bodyTemplate: template, idField: "data.id" }, gw.fetchImpl);
    const result = await sms.send({ to: "+989121234567", text: "کد ورود شما: 123456" });
    expect(result).toEqual({ providerMessageId: "8841" });
    const { url, init } = gw.calls[0]!;
    expect(url).toBe("https://sms.example.ir/send");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer placeholder");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ receiver: "+989121234567", message: "کد ورود شما: 123456", sender: "JARYAN" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("escapes values so text can never break out of the JSON template", async () => {
    const gw = fakeGateway(() => Response.json({}));
    const sms = new HttpSmsProvider({ url: "https://sms.example.ir/send", headers: {}, bodyTemplate: template }, gw.fetchImpl);
    await sms.send({ to: '+98"9', text: 'x","sender":"EVIL\n\\' });
    const body = JSON.parse(gw.calls[0]!.init.body as string) as Record<string, string>;
    expect(body.sender).toBe("JARYAN");
    expect(body.message).toBe('x","sender":"EVIL\n\\');
    expect(body.receiver).toBe('+98"9');
  });

  it("maps gateway failures to delivery errors without leaking the response", async () => {
    const down = new HttpSmsProvider({ url: "https://sms.example.ir/send", headers: {}, bodyTemplate: template }, fakeGateway(() => new Response("secret internal detail", { status: 502 })).fetchImpl);
    await expect(down.send({ to: "+989121234567", text: "x" })).rejects.toThrow(new SmsDeliveryError("sms_gateway_status_502"));
    const unreachable = new HttpSmsProvider({ url: "https://sms.example.ir/send", headers: {}, bodyTemplate: template }, (async () => {
      throw new Error("ECONNREFUSED 10.0.0.1");
    }) as typeof fetch);
    const error = await unreachable.send({ to: "+989121234567", text: "x" }).catch((e: Error) => e);
    expect(error).toMatchObject({ name: "SmsDeliveryError", message: "sms_gateway_unreachable" });
  });

  it("tolerates a gateway that returns no usable id", async () => {
    const sms = new HttpSmsProvider({ url: "https://sms.example.ir/send", headers: {}, bodyTemplate: template, idField: "id" }, fakeGateway(() => new Response("not json")).fetchImpl);
    expect(await sms.send({ to: "+989121234567", text: "x" })).toEqual({ providerMessageId: null });
  });

  it("requires https except for localhost", () => {
    expect(() => new HttpSmsProvider({ url: "http://sms.example.ir/send", headers: {}, bodyTemplate: template })).toThrow("sms_http_requires_https");
    expect(() => new HttpSmsProvider({ url: "http://127.0.0.1:9000/send", headers: {}, bodyTemplate: template })).not.toThrow();
  });
});

describe("other providers", () => {
  it("disabled provider can never send", async () => {
    await expect(new DisabledSmsProvider().send()).rejects.toBeInstanceOf(SmsNotConfiguredError);
  });

  it("console provider prints (development only) and memory provider records", async () => {
    const lines: string[] = [];
    await new ConsoleSmsProvider((l) => lines.push(l)).send({ to: "+989121234567", text: "کد: 123456\nخط دوم" });
    expect(lines).toEqual(["[dev sms] to +989121234567: کد: 123456 خط دوم"]);
    const mem = new MemorySmsProvider();
    await mem.send({ to: "+989121234567", text: "کد 654321" });
    expect(mem.lastCode("+989121234567")).toBe("654321");
    mem.failNext = new Error("boom");
    await expect(mem.send({ to: "+989121234567", text: "x" })).rejects.toThrow("boom");
  });
});
