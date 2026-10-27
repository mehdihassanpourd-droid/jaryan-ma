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

  it("never references an admin API path; the only API it may call is the CUSTOMER API, from one file", () => {
    // Admin routes (`/api/v1/products`, `/api/v1/auth`, ...) are private. The customer API (`/api/v1/customer`, sign-in by SMS code,
    // CORS + CSRF + SameSite cookie) is public by design and is reached only through src/lib/order-api.ts.
    const adminPaths = storefrontFiles.filter((file) => /\/api\/v1\/(?!customer\b|public\b)/.test(read(file)));
    expect(adminPaths).toEqual([]);
    const apiUsers = storefrontFiles.filter((file) => /\/api\/v1\//.test(read(file)) && !/\.test\./.test(file));
    expect(apiUsers).toEqual([join("src", "lib", "order-api.ts")]);
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

describe("the admin PWA stays private, portable and safe", () => {
  const adminSources = walk("admin/src", (f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
  const storefront = [...walk("src/app", (f) => /\.(ts|tsx)$/.test(f)), ...walk("src/components", (f) => /\.(ts|tsx)$/.test(f)), ...walk("src/lib", (f) => /\.(ts|tsx)$/.test(f))];

  it("has source files to check", () => {
    expect(adminSources.length).toBeGreaterThan(20);
  });

  it("the public storefront never imports admin code and the static export never builds it", () => {
    expect(storefront.filter((f) => /from\s+["'][^"']*admin\//.test(read(f)) || /["']\/admin\b/.test(read(f)))).toEqual([]);
    expect(read(".github/workflows/cloudflare-pages.yml")).not.toMatch(/dist\/admin|admin:build|admin\//);
    expect(read("next.config.ts")).not.toMatch(/admin/);
  });

  it("never imports server code, Prisma or Node-only modules (it runs in the browser)", () => {
    const offenders = adminSources.filter((f) => /from\s+["'](?:[^"']*\/server\/|server\/|[^"']*generated\/prisma|@prisma\/|node:|pg["'])/.test(read(f)) || /from\s+["']\.\.?\/(\.\.\/)*server/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("keeps secrets and personal data out of browser storage and avoids CSP-breaking constructs", () => {
    const hits = (re: RegExp) => adminSources.filter((f) => re.test(read(f)));
    expect(hits(/\b(localStorage|sessionStorage|indexedDB)\b/)).toEqual([]);
    expect(hits(/document\.cookie/)).toEqual([]);
    expect(hits(/dangerouslySetInnerHTML|\binnerHTML\b|\beval\(|new Function\(/)).toEqual([]);
    expect(hits(/\bstyle=\{/)).toEqual([]); // inline styles are blocked by the strict CSP
  });

  it("has no default accounts, bypass flags or mock logins", () => {
    expect(adminSources.filter((f) => /dev[-_ ]?bypass|mockLogin|fakeSession|DEV_ADMIN|skipAuth/i.test(read(f)))).toEqual([]);
  });

  it("the service worker never touches API or media responses", () => {
    const code = read("admin/src/sw.ts")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
      .join("\n");
    expect(code).not.toMatch(/\/api\/|\/media/);
    expect(code).toMatch(/const SCOPE = "\/admin\/"/);
    expect(code).toMatch(/pathname\.startsWith\(SCOPE\)/);
  });

  it("the admin server code serves files only from its build directory (no ports, vendors or DB)", () => {
    const source = read("server/admin-ui.ts");
    expect(source).not.toMatch(/prisma|@aws-sdk|cloudflare/i);
    expect(source).toContain("realpath");
  });

  it("the admin workflow exists", () => {
    expect(readdirSync(join(ROOT, ".github/workflows"))).toContain("admin.yml");
  });
});

describe("the Codespaces test environment stays private and uses real authentication", () => {
  const scripts = ["lib", "setup", "create-admin", "start", "up", "down", "update", "watch"].map((n) => `scripts/codespace/${n}.sh`);
  const everything = [...scripts, ".devcontainer/devcontainer.json", "scripts/codespace/smoke.ts"].map(read).join("\n");

  it("defines Node 22 + the forwarded admin port only, as pure JSON", () => {
    const config = JSON.parse(read(".devcontainer/devcontainer.json")) as { image: string; features: Record<string, { version?: string }>; forwardPorts: number[] };
    expect(config.image).toContain("ubuntu-24.04");
    expect(config.features["ghcr.io/devcontainers/features/node:1"]?.version).toBe("22");
    expect(config.forwardPorts).toEqual([3001]);
  });

  it("never makes a port public and never listens beyond localhost", () => {
    expect(everything).not.toMatch(/:public\b|visibility[ =]+public|"visibility"\s*:\s*"public"/i);
    expect(read("scripts/codespace/lib.sh")).toContain("listen_addresses=127.0.0.1");
    expect(read("scripts/codespace/lib.sh")).toContain("HOST=127.0.0.1");
  });

  it("enforces password + TOTP and Secure cookies, with no default account or bypass", () => {
    const lib = read("scripts/codespace/lib.sh");
    expect(lib).toContain("REQUIRE_TOTP=true");
    expect(lib).toContain("COOKIE_SECURE=true");
    expect(lib).toContain("unset DEV_ADMIN_EMAIL DEV_ADMIN_PASSWORD");
    expect(lib).toContain("CUSTOMER_ACCOUNTS_ENABLED=false");
    expect(everything).not.toMatch(/REQUIRE_TOTP=false|COOKIE_SECURE=false|DEV_ADMIN_(EMAIL|PASSWORD)=|NODE_ENV=production/);
  });

  it("browser first-run setup is development-only: refused in production, never enabled by deploy docs or workflows", () => {
    expect(read("server/config.ts")).toContain("FIRST_RUN_SETUP is development-only and not allowed in production");
    expect(read("server/config.ts")).toMatch(/firstRunSetup: !production &&/);
    expect(read("scripts/codespace/lib.sh")).toContain("FIRST_RUN_SETUP=true");
    for (const file of [".github/workflows/cloudflare-pages.yml", ".github/workflows/admin.yml", "docs/admin/SELF-HOSTING.md"]) {
      expect(read(file), file).not.toMatch(/FIRST_RUN_SETUP\s*[=:]\s*["']?true/);
    }
  });

  it("the forwarded-host origin rule is development-only, never a wildcard, and never enabled by deploy docs or workflows", () => {
    const config = read("server/config.ts");
    expect(config).toContain("ADMIN_ORIGIN_HOST_SUFFIXES is development-only and not allowed in production");
    expect(config).toMatch(/adminOriginHostSuffixes: production \? \[\]/);
    expect(read("scripts/codespace/start.sh")).toContain("ADMIN_ORIGIN_HOST_SUFFIXES");
    for (const file of [".github/workflows/cloudflare-pages.yml", ".github/workflows/admin.yml", "docs/admin/SELF-HOSTING.md"]) {
      expect(read(file), file).not.toContain("ADMIN_ORIGIN_HOST_SUFFIXES");
    }
    // the check itself must still compare against the host the request was addressed to (not merely a suffix)
    expect(read("server/http.ts")).toContain("requestedHosts(request).includes(host)");
  });

  it("the rewritten-origin rule is development-only, port-bound, Host-checked and Referer-vetoed, and never enabled by deploy docs or workflows", () => {
    const config = read("server/config.ts");
    expect(config).toContain("ADMIN_ACCEPT_REWRITTEN_ORIGIN is development-only and not allowed in production");
    expect(config).toMatch(/adminAcceptRewrittenOrigin: !production &&/);
    expect(read("scripts/codespace/start.sh")).toContain("ADMIN_ACCEPT_REWRITTEN_ORIGIN=true");
    const http = read("server/http.ts");
    expect(http).toContain("url.port !== String(port)"); // only this server own port
    expect(http).toContain("requestedHosts(request).includes(url.host)"); // Host must agree
    expect(http).toContain('request.headers.get("referer")'); // a foreign Referer vetoes
    for (const file of [".github/workflows/cloudflare-pages.yml", ".github/workflows/admin.yml", "docs/admin/SELF-HOSTING.md"]) {
      expect(read(file), file).not.toContain("ADMIN_ACCEPT_REWRITTEN_ORIGIN");
    }
  });

  it("keeps the database password out of the repository (random, in the git-ignored state dir)", () => {
    expect(read("scripts/codespace/setup.sh")).toMatch(/openssl rand -hex/);
    expect(read(".gitignore")).toMatch(/^\/\.data\/$/m);
  });

  it("all scripts are syntactically valid bash", () => {
    for (const file of scripts) expect(() => execFileSync("bash", ["-n", join(ROOT, file)]), file).not.toThrow();
  });

  it("is not part of the static site or its deployment", () => {
    expect(read(".github/workflows/cloudflare-pages.yml")).not.toMatch(/codespace|devcontainer/i);
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
