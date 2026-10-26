export type Role = "owner" | "editor" | "support" | "viewer";
export const ROLES: readonly Role[] = ["owner", "editor", "support", "viewer"];

export const ACTIONS = [
  // catalogue
  "product:read",
  "product:write",
  "product:publish",
  "product:import",
  "image:upload",
  "category:write",
  "catalog:sync",
  // customer support
  "support:read",
  "support:reply",
  "support:note",
  "support:manage",
  "faq:write",
  "customer:read",
  // operations
  "customer:manage",
  "maintenance:read",
  "maintenance:write",
  "admin:manage",
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Least privilege per role.
 * - viewer: read the catalogue.
 * - editor: manages the catalogue and the FAQ; no access to customers' conversations.
 * - support: works tickets (reply, internal notes, status/priority/assignment), edits the FAQ and sees the
 *   customer details a ticket needs; cannot change the catalogue.
 * - owner: everything, including operations (incidents, backups, customer data requests, admin management).
 */
const GRANTS: Record<Role, readonly Action[]> = {
  viewer: ["product:read"],
  editor: ["product:read", "product:write", "product:publish", "product:import", "image:upload", "category:write", "catalog:sync", "faq:write"],
  support: ["product:read", "support:read", "support:reply", "support:note", "support:manage", "faq:write", "customer:read"],
  owner: ACTIONS,
};

export function can(role: Role, action: Action): boolean {
  return GRANTS[role].includes(action);
}
