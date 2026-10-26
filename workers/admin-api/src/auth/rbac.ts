export type Role = "owner" | "editor" | "viewer";

export const ACTIONS = [
  "product:read",
  "product:write",
  "product:publish",
  "product:import",
  "image:upload",
  "category:write",
  "catalog:sync",
  "admin:manage",
] as const;
export type Action = (typeof ACTIONS)[number];

const GRANTS: Record<Role, readonly Action[]> = {
  viewer: ["product:read"],
  editor: ["product:read", "product:write", "product:publish", "product:import", "image:upload", "category:write", "catalog:sync"],
  owner: ACTIONS,
};

export function can(role: Role, action: Action): boolean {
  return GRANTS[role].includes(action);
}
