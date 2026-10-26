import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guard-rails over the repository itself. They fail the build when someone accidentally breaks a
 * security or architecture rule that is easy to break silently (see CLAUDE.md "Hard rules").
 */
const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === "node_modules" || name === "generated" || name.startsWith(".")) continue;
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, accept, out);
    else if (accept(rel)) out.push(rel);
  }
  return out;
}

describe("the public storefront stays separate from the server", () => {
  const storefrontFiles = [...walk("src/app", (f) => /\.(ts|tsx)$/.test(f)), ...walk("src/components", (f) => /\.(ts|tsx)$/.test(f)), ...walk("src/lib", (f) => /\.(ts|tsx)$/.test(f))];

  it("has source files to check", () => {
    expect(storefrontFiles.length).toBeGreaterThan(5);
  });

  it("never imports server code, Prisma or Node-only modules", () => {
    const offenders = storefrontFiles.filter((file) => {
      const source = read(file);
      return /from\s+["'][^"']*(\/server\/|^server\/|generated\/prisma|@prisma\/|node:|pg["'])/.test(source) || /from\s+["']\.\.?\/(\.\.\/)*server/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("does not reference admin or customer API paths (they are not part of the static site)", () => {
    const offenders = storefrontFiles.filter((file) => /\/api\/v1\//.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("keeps the static export that Cloudflare Pages relies on", () => {
    expect(read("next.config.ts")).toMatch(/output:\s*"export"/);
    expect(walk("src/app", (f) => /(route|middleware)\.(ts|js)$/.test(f))).toEqual([]);
  });

  it("injects raw markup in exactly one audited place (JSON-LD), which escapes its payload", () => {
    const users = walk("src", (f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)).filter((f) => read(f).includes("dangerouslySetInnerHTML"));
    expect(users).toEqual([join("src", "seo", "JsonLd.tsx")]);
    expect(read("src/seo/JsonLd.tsx")).toContain("serializeJsonLd(");
    expect(read("src/seo/jsonld.ts")).toMatch(/replace\(\/<\/g, "\\\\u003c"\)/);
  });
});

describe("secrets stay out of git", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

  it("tracks no .env file except the placeholder example", () => {
    expect(tracked.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example"))).toEqual([]);
  });

  it("tracks no private keys, dumps or backups", () => {
    expect(tracked.filter((f) => /\.(pem|key|p12|pfx|dump|dump\.enc|sql\.gz)$/.test(f) && !f.endsWith("migration.sql"))).toEqual([]);
    expect(tracked.filter((f) => /^(backups|\.data)\//.test(f))).toEqual([]);
  });

  it(".env.example only holds placeholders (no real-looking secrets)", () => {
    const values = read(".env.example")
      .split("\n")
      .filter((l) => /^#?\s*[A-Z0-9_]+=/.test(l))
      .map((l) => l.replace(/^#?\s*[A-Z0-9_]+=/, "").replace(/^"|"$/g, ""));
    expect(values.length).toBeGreaterThan(5);
    for (const value of values) {
      expect(value, value).not.toMatch(/[A-Za-z0-9+/]{32,}={0,2}/); // long random-looking strings
      expect(value, value).not.toMatch(/AKIA[0-9A-Z]{12,}/);
    }
  });

  it("no source file contains a hard-coded credential-looking literal", () => {
    const files = walk("server", (f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f)).concat(walk("src", (f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)));
    const offenders = files.filter((f) => /(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(ql)?:\/\/[^\s"'`$]+:[^\s"'`$@]+@(?!localhost|127\.0\.0\.1))/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("server code follows the security rules", () => {
  const serverFiles = walk("server", (f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && !f.includes("testing/"));

  it("never uses Math.random (tokens, codes and ids come from node:crypto)", () => {
    expect(serverFiles.filter((f) => read(f).includes("Math.random"))).toEqual([]);
  });

  it("does not log request bodies, cookies or codes", () => {
    const offenders = serverFiles.filter((f) => /(?<!console\.)\blog\([^)]*(request\.(text|json)|\.cookie|codeHash|password|authorization)/i.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("never selects customer secrets into API responses (store modules map to explicit views)", () => {
    for (const file of ["server/customer-api.ts", "server/routes/admin-support.ts", "server/routes/admin-maintenance.ts"]) {
      expect(read(file), file).not.toMatch(/tokenHash|codeHash|passwordHash|totpSecret/);
    }
  });

  it("customer-facing support queries never touch internal notes", () => {
    const store = read("server/support/prisma-store.ts");
    const customerPart = store.slice(store.indexOf("// ---- customer side"), store.indexOf("// ---- staff side"));
    expect(customerPart).not.toMatch(/supportNote|notes/);
  });

  it("the dev-only console SMS provider is refused in production by configuration", () => {
    expect(read("server/config.ts")).toContain("SMS_PROVIDER=console prints sign-in codes to the log and is not allowed in production");
  });
});

describe("GitHub workflows", () => {
  const dir = ".github/workflows";
  const files = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".yml"));

  it("exist", () => {
    expect(files).toEqual(expect.arrayContaining(["cloudflare-pages.yml", "site-health.yml", "deployment-watch.yml", "security-audit.yml", "database.yml"]));
  });

  for (const file of files) {
    const source = read(join(dir, file));
    it(`${file}: actions are pinned to a commit SHA`, () => {
      const uses = [...source.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1] as string);
      for (const u of uses) expect(u, u).toMatch(/@[0-9a-f]{40}$/);
    });
    it(`${file}: declares least-privilege permissions and avoids pull_request_target`, () => {
      expect(source).toMatch(/^permissions:/m);
      expect(source).not.toContain("pull_request_target");
      expect(source).not.toMatch(/permissions:\s*write-all/);
    });
    it(`${file}: does not interpolate attacker-controlled event fields`, () => {
      expect(source).not.toMatch(/\$\{\{\s*github\.(head_ref|event\.(issue\.(title|body)|pull_request\.(title|body|head\.ref)|comment\.body|review\.body|head_commit\.message|workflow_run\.(display_title|head_commit)))/);
    });
  }

  it("the Cloudflare deployment workflow is the one from main (not modified by this work)", () => {
    // Guard against accidental edits: the deploy job and its secret names must still be present.
    const source = read(join(dir, "cloudflare-pages.yml"));
    expect(source).toContain("CLOUDFLARE_API_TOKEN");
    expect(source).toContain("cloudflare/wrangler-action");
    expect(relative(ROOT, join(ROOT, dir))).toBe(dir);
  });
});
