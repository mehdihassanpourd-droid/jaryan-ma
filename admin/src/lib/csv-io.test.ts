import { describe, expect, it } from "vitest";
import { csvIssueMessage, mapLimit } from "./csv-io";

describe("csv helpers", () => {
  it("mapLimit keeps order and never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5 * (9 - n)));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(peak).toBeLessThanOrEqual(3);
  });
  it("every parser issue code has a Persian message", () => {
    for (const code of ["csv_too_large", "unknown_column", "missing_column", "invalid_number", "unknown_category", "invalid_variant_options", "conflicting_product_fields"]) {
      expect(csvIssueMessage({ code })).toMatch(/[آ-ی]/);
    }
  });
});
