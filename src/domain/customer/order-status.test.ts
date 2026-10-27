import { describe, expect, it } from "vitest";
import { canTransition, isFinal, nextStatuses, ORDER_STATUSES, OPEN_STATUSES, releasesStock, ORDER_STATUS_LABEL, ORDER_ACTION_LABEL } from "./order-status";

describe("order state machine", () => {
  it("staff walk an order forward; reject and cancel are the only exits", () => {
    expect(nextStatuses("pending", "staff")).toEqual(["confirmed", "rejected", "cancelled"]);
    expect(nextStatuses("confirmed", "staff")).toEqual(["preparing", "cancelled"]);
    expect(nextStatuses("preparing", "staff")).toEqual(["shipped", "cancelled"]);
    expect(nextStatuses("shipped", "staff")).toEqual(["delivered"]);
  });

  it("a customer may only cancel their own PENDING order; the system does nothing by itself", () => {
    expect(nextStatuses("pending", "customer")).toEqual(["cancelled"]);
    for (const from of ORDER_STATUSES.filter((s) => s !== "pending")) expect(nextStatuses(from, "customer"), from).toEqual([]);
    for (const from of ORDER_STATUSES) expect(nextStatuses(from, "system"), from).toEqual([]);
  });

  it("final statuses never change; nothing skips a step or goes backwards", () => {
    for (const s of ["delivered", "cancelled", "rejected"] as const) {
      expect(isFinal(s)).toBe(true);
      for (const to of ORDER_STATUSES) expect(canTransition(s, to, "staff"), `${s}->${to}`).toBe(false);
    }
    expect(canTransition("pending", "shipped", "staff")).toBe(false);
    expect(canTransition("pending", "delivered", "staff")).toBe(false);
    expect(canTransition("confirmed", "pending", "staff")).toBe(false);
    expect(canTransition("shipped", "cancelled", "staff")).toBe(false); // too late: it has left
    expect(canTransition("pending", "pending", "staff")).toBe(false);
  });

  it("only rejection and cancellation give stock back; open means not finished", () => {
    expect(ORDER_STATUSES.filter(releasesStock)).toEqual(["cancelled", "rejected"]);
    expect(OPEN_STATUSES).toEqual(["pending", "confirmed", "preparing", "shipped"]);
  });

  it("every status has a Persian label and every target has an action label", () => {
    for (const s of ORDER_STATUSES) {
      expect(ORDER_STATUS_LABEL[s]).toBeTruthy();
      expect(ORDER_ACTION_LABEL[s]).toBeTruthy();
    }
  });
});
