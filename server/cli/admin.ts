import { Writable } from "node:stream";
import { createInterface } from "node:readline";
import { AuthFailure } from "../auth/auth-service";
import type { Role } from "../auth/rbac";
import { generateTotpSecret, verifyTotp } from "../auth/totp";
import { ConfigError, loadConfig } from "../config";
import { createAuthServices, openDatabase } from "../runtime";

/**
 * Administrator management. There is no public sign-up and no default account: administrators are
 * created here, by someone with shell access to the server.
 *
 *   npm run admin -- create --email you@example.com --role owner
 *   npm run admin -- list
 *   npm run admin -- reset-password --email you@example.com
 *   npm run admin -- reset-totp --email you@example.com
 *   npm run admin -- disable|enable --email you@example.com
 *
 * Passwords are typed at a hidden prompt (or read from stdin when piped), never passed as arguments.
 */
const muted = { on: false };
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted.on) process.stdout.write(chunk, encoding);
    callback();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });

// Lines can arrive before a question is asked (piped input while the database connects), and
// readline drops them unless they are queued.
const queued: string[] = [];
const waiting: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
rl.on("line", (line) => {
  const waiter = waiting.shift();
  if (waiter) waiter.resolve(line);
  else queued.push(line);
});
rl.on("close", () => {
  for (const waiter of waiting.splice(0)) waiter.reject(new Error("input_closed"));
});

function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted.on = hidden;
  return new Promise<string>((resolve, reject) => {
    const finish = (line: string) => {
      muted.on = false;
      if (hidden && process.stdin.isTTY) process.stdout.write("\n");
      resolve(line);
    };
    const line = queued.shift();
    if (line !== undefined) finish(line);
    else waiting.push({ resolve: finish, reject });
  });
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function newPassword(): Promise<string> {
  const first = await ask("New password (min 12 characters): ", true);
  const second = await ask("Repeat password: ", true);
  if (first !== second) throw new Error("passwords_do_not_match");
  return first;
}

async function enrollTotp(provisioningUri: (secret: string) => string): Promise<string> {
  const secret = generateTotpSecret();
  console.log("\nAdd this account to an authenticator app (Google Authenticator, Aegis, 2FAS, ...):");
  console.log(`  Secret : ${secret}`);
  console.log(`  URI    : ${provisioningUri(secret)}`);
  const code = (await ask("\nEnter the 6-digit code shown by the app to confirm: ")).trim();
  if (verifyTotp(secret, code, Date.now(), null) === null) throw new Error("totp_code_incorrect");
  return secret;
}

async function run() {
  const [command, ...args] = process.argv.slice(2);
  const email = option(args, "email");
  if (!command || (command !== "list" && !email)) {
    console.error("Usage: admin <create|list|reset-password|reset-totp|disable|enable> --email <address> [--role owner|editor|viewer]");
    process.exit(2);
  }
  const config = loadConfig(process.env);
  const database = await openDatabase(config, () => undefined);
  const { service } = createAuthServices(config, database.db);
  try {
    switch (command) {
      case "create": {
        const role = (option(args, "role") ?? "editor") as Role;
        if (!["owner", "editor", "viewer"].includes(role)) throw new Error("invalid_role");
        const password = await newPassword();
        const totpSecret = config.requireTotp ? await enrollTotp((s) => service.provisioningUri(email!, s)) : null;
        const account = await service.createAccount({ email: email!, password, role, totpSecret });
        console.log(`\nCreated ${role} ${account.email}${totpSecret ? " with two-factor authentication" : " (two-factor NOT enabled; development only)"}.`);
        break;
      }
      case "reset-password":
        await service.resetPassword(email!, await newPassword());
        console.log("Password changed; all sessions of this account were signed out.");
        break;
      case "reset-totp": {
        const secret = await enrollTotp((s) => service.provisioningUri(email!, s));
        await service.resetTotp(email!, secret);
        console.log("Authenticator replaced; all sessions of this account were signed out.");
        break;
      }
      case "disable":
      case "enable":
        await service.setDisabled(email!, command === "disable");
        console.log(`${email} ${command}d.`);
        break;
      case "list":
        console.table(await service.listAccounts());
        break;
      default:
        throw new Error(`unknown_command:${command}`);
    }
  } finally {
    rl.close();
    await database.stop();
  }
}

run().catch((error) => {
  if (error instanceof ConfigError) console.error(error.message);
  else if (error instanceof AuthFailure) console.error(`Not accepted: ${error.code}${error.issues ? ` (${error.issues.join(", ")})` : ""}`);
  else console.error(`Failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
