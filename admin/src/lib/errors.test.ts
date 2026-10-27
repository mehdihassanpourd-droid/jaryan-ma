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

  it("ignores malformed details", () => {
    expect(originDetailText(null)).toBe("");
    expect(originDetailText("x")).toBe("");
    expect(apiErrorMessage(new ApiError(403, "bad_origin", [], undefined, "nonsense"))).toBe("این درخواست از آدرس مجاز ارسال نشد.");
  });
});
