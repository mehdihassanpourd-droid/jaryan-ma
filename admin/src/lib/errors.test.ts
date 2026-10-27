import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { apiErrorMessage, originDetailText } from "./errors";

describe("refused-origin message", () => {
  it("is the plain Persian message when the server explains nothing (production)", () => {
    expect(apiErrorMessage(new ApiError(403, "bad_origin"))).toBe("این درخواست از آدرس مجاز ارسال نشد.");
  });

  it("adds what was compared when a development server explains it", () => {
    const detail = { receivedOrigin: "https://a-3001.app.github.dev", requestedHost: ["127.0.0.1:3001"], allowedOrigins: "https://b-3001.app.github.dev" };
    const text = apiErrorMessage(new ApiError(403, "bad_origin", [], undefined, detail));
    expect(text).toContain("این درخواست از آدرس مجاز ارسال نشد.");
    expect(text).toContain("https://a-3001.app.github.dev");
    expect(text).toContain("127.0.0.1:3001");
    expect(text).toContain("https://b-3001.app.github.dev");
  });

  it("also shows the Referer and the running version, so one screenshot says everything", () => {
    const text = originDetailText({ receivedOrigin: "http://localhost:3001", requestedHost: ["localhost:3001", "localhost:3001"], allowedOrigins: "https://x-3001.app.github.dev", referer: "https://x-3001.app.github.dev", build: "abc1234" });
    expect(text).toContain("Origin دریافتی: http://localhost:3001");
    expect(text).toContain("Host درخواست: localhost:3001 |"); // de-duplicated
    expect(text).toContain("Referer: https://x-3001.app.github.dev");
    expect(text).toContain("نسخه: abc1234");
  });

  it("ignores malformed details", () => {
    expect(originDetailText(null)).toBe("");
    expect(originDetailText("x")).toBe("");
    expect(apiErrorMessage(new ApiError(403, "bad_origin", [], undefined, "nonsense"))).toBe("این درخواست از آدرس مجاز ارسال نشد.");
  });
});
