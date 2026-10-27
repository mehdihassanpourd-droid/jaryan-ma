// Creates test administrators (with real TOTP secrets) in the development database. Run by the E2E harness only:
//   DEV_DATA_DIR=<dir> tsx admin/e2e/seed.ts <out.json>
import { writeFileSync } from "node:fs";
import { generateTotpSecret } from "../../server/auth/totp";
import { loadConfig } from "../../server/config";
import type { Role } from "../../server/auth/rbac";
import { createAuthServices, openDatabase } from "../../server/runtime";

export const E2E_PASSWORD = "rain-over-the-woven-hills-92";
const ROLES: Role[] = ["owner", "editor", "viewer"];

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("usage: seed.ts <out.json>");
  const config = loadConfig(process.env);
  const database = await openDatabase(config, () => undefined);
  const { service } = createAuthServices(config, database.db);
  const accounts: Record<string, { email: string; password: string; secret: string }> = {};
  for (const role of ROLES) {
    const email = `${role}@e2e.test`;
    const secret = generateTotpSecret();
    await service.createAccount({ email, password: E2E_PASSWORD, role, totpSecret: secret });
    accounts[role] = { email, password: E2E_PASSWORD, secret };
  }
  writeFileSync(out, JSON.stringify(accounts));
  await database.stop();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
