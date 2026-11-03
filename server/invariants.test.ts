import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
    expect(files).toEqual(expect.arrayContaining(["cloudflare-pages.yml", "site-health.yml", "deployment-watch.yml", "security-audit.yml", "database.yml", "seo-monitor.yml"]));
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

describe("no mandatory foreign runtime dependency", () => {
  // The production store must keep working inside Iran when the international internet is cut: nothing the storefront or the admin
  // loads or calls at run time may live on a foreign host (fonts, CDNs, analytics, scripts, APIs are bundled or self-hosted). The only
  // foreign addresses in the source are links the shopper may click, identifiers that are never fetched, and placeholders.
  const ALLOWED = [/^http:\/\/localhost/, /^http:\/\/127\.0\.0\.1/, /^https:\/\/(www\.)?instagram\.com\//, /^https:\/\/schema\.org(\/|$)/, /^http:\/\/www\.w3\.org\/2000\/svg$/, /^https?:\/\/([a-z0-9-]+\.)*example\.(ir|com|test)/];
  const sources = [...walk("src", (f) => /\.(ts|tsx|css|html)$/.test(f) && !/\.test\./.test(f)), ...walk("admin/src", (f) => /\.(ts|tsx|css|html)$/.test(f) && !/\.test\./.test(f)), "admin/index.html", ...walk("public", () => true)];

  it("every absolute URL in the storefront and admin source is a link, an identifier or a placeholder (see the allow-list)", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      for (const match of read(file).matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) {
        if (!ALLOWED.some((ok) => ok.test(match[0]))) offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the admin page loads no external script, stylesheet or font", () => {
    const html = read("admin/index.html");
    expect(html).not.toMatch(/<(script|link)\b[^>]*(src|href)=["']https?:/i);
    expect(read("admin/src/styles/admin.css")).not.toMatch(/@import\s+url\(["']?https?:/);
  });
});

describe("the public preview deployment proves its result", () => {
  const workflow = () => read(".github/workflows/cloudflare-pages.yml");
  it("records the commit in the build and fetches it back from the live site after deploying", () => {
    expect(workflow()).toContain("out/build-info.json");
    expect(workflow()).toContain("scripts/deploy/verify-live.sh");
    expect(workflow().indexOf("Verify the live site serves this commit")).toBeGreaterThan(workflow().indexOf("- name: Deploy\n"));
  });
  it("holds production back until every other check on the commit is green", () => {
    expect(workflow()).toContain("scripts/deploy/wait-for-checks.sh");
    expect(workflow().indexOf("Wait for the other checks")).toBeLessThan(workflow().indexOf("- name: Deploy\n"));
  });
  it("deploys only what the build job produced, with read-only repository access", () => {
    expect(workflow()).toMatch(/needs: build/);
    expect(workflow()).not.toMatch(/contents:\s*write/);
  });
});

describe("SEO modules shared with the admin app stay browser-safe", () => {
  // admin/src/lib/seo-suggest.ts bundles src/seo/catalog-seo.ts; anything it reaches must not need Node.
  const nodeOnly = new Set(["src/seo/index.ts", "src/seo/overrides-file.ts", "src/seo/catalog-source.ts"]);
  it("keeps node: imports (direct or via overrides-file/catalog-source/index) out of the shared SEO modules", () => {
    const offenders = walk("src/seo", (f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
      .filter((f) => !nodeOnly.has(f.replaceAll("\\", "/")))
      .filter((f) => /from\s+["']node:/.test(read(f)) || /from\s+["']\.\/(index|overrides-file|catalog-source)["']/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("SEO automation (tools/seo-growth and its workflow)", () => {
  const tools = walk("tools/seo-growth", (f) => /\.ts$/.test(f) && !/\.test\./.test(f));
  const monitor = read(".github/workflows/seo-monitor.yml");

  it("runs only in GitHub Actions / developer machines: the storefront, the admin and the API server never import it", () => {
    const users = [...walk("src", (f) => /\.(ts|tsx)$/.test(f)), ...walk("admin/src", (f) => /\.(ts|tsx)$/.test(f)), ...walk("server", (f) => /\.ts$/.test(f) && !/invariants\.test\.ts$/.test(f))].filter((f) => /(from|import)\s*\(?\s*["'][^"']*seo-growth/.test(read(f)));
    expect(users).toEqual([]);
  });

  it("never merges anything and never enables auto-merge (pull requests are opened for a person to review)", () => {
    for (const source of [monitor, ...tools.map(read), read("scripts/seo/data-branch.sh")]) {
      expect(source).not.toMatch(/gh\s+pr\s+merge|merge_pull_request|--auto\b|enable-pr-auto-merge|gh\s+api[^\n]*merge/i);
    }
    expect(monitor).toContain("gh pr create");
  });

  it("writes only its own history branch and a proposals branch, never the default branch", () => {
    const script = read("scripts/seo/data-branch.sh");
    expect(script).toContain('HEAD:refs/heads/$BRANCH');
    expect(script).not.toMatch(/push[^\n]*\bmain\b/);
    expect(monitor).not.toMatch(/git[^\n]*push[^\n]*\bmain\b/);
    expect(monitor).toContain('branch="seo/proposals-');
  });

  it("only the jobs that need to write have write permissions, and secrets are never echoed", () => {
    expect(monitor).toMatch(/^permissions:\n  contents: read/m);
    expect(monitor).not.toMatch(/echo[^\n]*\$\{\{\s*secrets\./);
    expect(monitor).not.toMatch(/(?<!\$\{\{ )secrets\.GSC_SERVICE_ACCOUNT_JSON(?!\s*\}\})/);
    expect(monitor).not.toContain("pull_request");
  });

  it("the Pages workflow can be re-run by automation only from main and still deploys a preview for pull requests only", () => {
    const pages = read(".github/workflows/cloudflare-pages.yml");
    expect(pages).toContain("workflow_dispatch:");
    expect(pages).toContain("github.event_name != 'workflow_dispatch' || github.ref == 'refs/heads/main'");
    expect(pages).toContain("--branch=${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || 'main' }}");
  });

  it("needs no paid service or AI API (plain code and the free Search Console API only)", () => {
    const text = tools.map(read).join("\n");
    expect(text).not.toMatch(/api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis|ahrefs|semrush|moz\.com/i);
    expect([...text.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map((m) => new URL(m[0]).hostname).filter((h) => !/^(www\.googleapis\.com|oauth2\.googleapis\.com|schema\.org|example|jaryan|demo)/.test(h) && !h.endsWith(".example") && !h.endsWith(".test"))).toEqual([]);
  });
});

describe("the visual identity follows the official logo", () => {
  const storefront = [...walk("src/app", (f) => /\.(tsx?|css)$/.test(f)), ...walk("src/components", (f) => /\.tsx?$/.test(f))];

  it("keeps the uploaded logo byte-for-byte as received", () => {
    const sha = createHash("sha256").update(readFileSync(join(ROOT, "brand/original/jaryan-ma-logo-official.jpg"))).digest("hex");
    expect(sha).toBe("b6f8f3bfff8e90061497e26c50155c711c5adbe33ed55aa8e54da87cf184b7da");
  });

  it("ships the logo's own colours as the brand tokens (burgundy and cream sampled from the original)", () => {
    const css = read("src/app/globals.css").toLowerCase();
    expect(css).toContain("--color-burgundy-600: #5e1526");
    expect(css).toContain("--color-ivory-200: #e9d8c4");
    expect(css).toContain("--color-ivory-50: #faf8f4");
    expect(css).toContain("--color-bark-900: #292524");
  });

  it("draws no curved frames: no rounded utilities, blobs, arches or radius rules anywhere in the storefront", () => {
    const offenders = storefront.filter((f) => /\brounded(-[a-z0-9[\]./%_-]+)?(?=[\s"'`])|\bblob-[a-d]\b|border-radius|@utility (arch|leaf)/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("keeps the mobile viewport: device width, scale 1, and nothing that disables zoom", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toMatch(/export const viewport[^=]*=\s*\{[^}]*width:\s*"device-width"/s);
    expect(layout).toMatch(/initialScale:\s*1\b/);
    expect(layout).not.toMatch(/maximumScale|userScalable|minimumScale/);
    // and the deployment proves it on the live pages
    expect(read("scripts/deploy/verify-live.sh")).toContain('<meta name="viewport" content="width=device-width, initial-scale=1"');
  });

  it("uses the official logo files, never a redrawn or typed one", () => {
    expect(read("src/components/layout/Header.tsx")).toContain("<Logo");
    expect(read("src/components/layout/Footer.tsx")).toContain("<Logo");
    expect(read("src/components/layout/Logo.tsx")).toContain("/brand/jaryan-ma-mark-");
  });
});

describe("store reliability tooling stays read-only, local and redacted (Phase 1)", () => {
  const WRITES = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$executeRaw|\$queryRawUnsafe|\bINSERT\b|\bUPDATE\b\s+\w|\bDELETE\s+FROM\b|\bTRUNCATE\b/;

  it("the reconciliation modules never write to the database", () => {
    for (const file of ["src/domain/maintenance/reconciliation.ts", "server/maintenance/reconciliation.ts"]) {
      expect(read(file), file).not.toMatch(WRITES);
      expect(read(file), file).not.toMatch(/from "node:(fs|child_process|http|https|net)/);
    }
  });

  it("every reconciliation query is bounded (take) and uses keyset paging", () => {
    const source = read("server/maintenance/reconciliation.ts");
    const finds = source.match(/\.(findMany|findFirst)\(/g) ?? [];
    expect(finds.length).toBeGreaterThanOrEqual(4);
    expect(source.match(/take: Math\.max\(1, Math\.min\(page\.take, MAX_PAGE_SIZE\)\)/g)).toHaveLength(2); // orders and products are both read a bounded page at a time
    expect(source).toMatch(/number: \{ lt: /);
    expect(source).toMatch(/id: \{ gt: /);
    expect(source).toContain("MAX_PAGE_SIZE");
  });

  it("the reconciliation query selects no personal column", () => {
    const source = read("server/maintenance/reconciliation.ts");
    expect(source).not.toMatch(/\b(customer|shipping|customerNote|phone|firstName|lastName|email|address|recipient)\b\s*:/);
  });

  it("only the optional webhook sink may reach the network, and the restore drill refuses the production server", () => {
    const alerts = read("server/alerts/alerts.ts");
    expect(alerts.match(/fetchImpl\(|fetch\(/g)?.length).toBe(1);
    expect(alerts).not.toMatch(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    const drill = read("scripts/maintenance/restore-drill.sh");
    expect(drill).toContain("the scratch server is the production server");
    expect(drill).not.toMatch(/\bDROP\b|pg_restore\b.*DATABASE_URL/);
  });

  it("the HTTP entry point wraps the handler with request ids and redacted logging", () => {
    expect(read("server/main.ts")).toContain("observeRequests(runtime.handle");
    expect(read("server/runtime.ts")).toContain("createLogger");
  });

  it("request bodies, headers and cookies are never passed to the logger by the request wrapper", () => {
    const wrapper = read("server/observability/logger.ts");
    expect(wrapper).not.toMatch(/request\.(text|json|formData|arrayBuffer|body)\b/);
    expect(wrapper).not.toMatch(/headers\.get\("(cookie|authorization)"\)/i);
  });

  describe("systemd templates and runbooks", () => {
    const units = readdirSync(join(ROOT, "ops/systemd")).filter((f) => /\.(service|timer)$/.test(f));

    it("ship a service and a timer for backup, verification and restore drill", () => {
      for (const name of ["jaryan-backup", "jaryan-backup-verify", "jaryan-restore-drill"]) {
        expect(units, name).toContain(`${name}.service`);
        expect(units, name).toContain(`${name}.timer`);
        expect(read(`ops/systemd/${name}.timer`)).toMatch(/OnCalendar=.+\nRandomizedDelaySec=\d+\nPersistent=true/);
      }
    });

    it("run unprivileged and hardened, read secrets from environment files, and hold no secret themselves", () => {
      for (const file of units.filter((f) => f.endsWith(".service"))) {
        const text = read(`ops/systemd/${file}`);
        expect(text, file).toMatch(/^User=jaryan$/m);
        expect(text, file).not.toMatch(/^User=root/m);
        expect(text, file).toMatch(/^EnvironmentFile=\/etc\/jaryan-ma\//m);
        for (const hardening of ["NoNewPrivileges=yes", "ProtectSystem=strict", "PrivateTmp=yes", "UMask=0077"]) expect(text, `${file} ${hardening}`).toContain(hardening);
        expect(text, file).not.toMatch(/postgres(ql)?:\/\/[^\s]*:[^\s@]+@|BACKUP_ENCRYPTION_KEY=\S|PASSWORD=\S/);
      }
    });

    it("the restore-drill unit can only run the guarded script against the scratch server", () => {
      const text = read("ops/systemd/jaryan-restore-drill.service");
      expect(text).toContain("ExecStart=/opt/jaryan-ma/current/scripts/maintenance/restore-drill.sh");
      expect(text).toContain("EnvironmentFile=/etc/jaryan-ma/restore-drill.env");
      expect(text).not.toContain("ALLOW_SAME_SERVER");
      expect(read("ops/systemd/restore-drill.env.example")).toContain("RESTORE_TEST_ADMIN_URL=");
      expect(read("ops/systemd/restore-drill.env.example")).not.toMatch(/DATABASE_URL/);
    });

    it("example environment files contain no real secret and real ones are not tracked", () => {
      expect(read("ops/systemd/ops.env.example")).toMatch(/^BACKUP_ENCRYPTION_KEY=$/m);
      const tracked = execFileSync("git", ["ls-files", "ops"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
      expect(tracked.filter((f) => /\.env$/.test(f))).toEqual([]);
    });

    it("the runbooks cover rollback, failed deployments, migrations and the proxy request-id rule", () => {
      const rollback = read("docs/maintenance/ROLLBACK-FA.md");
      for (const must of ["بازگشت برنامه", "استقرار ناموفق", "forward-fix", "هرگز کورکورانه معکوس نکنید", "prisma migrate resolve --rolled-back"]) expect(rollback, must).toContain(must);
      expect(read("docs/maintenance/SYSTEMD-FA.md")).toContain("0700");
      expect(read("docs/maintenance/INCIDENT-RESPONSE-FA.md")).toContain("TRUST_PROXY=true");
    });
  });
});

describe("GitHub workflow files are valid YAML (a broken file silently never runs)", () => {
  for (const file of readdirSync(join(ROOT, ".github/workflows")).filter((f) => f.endsWith(".yml"))) {
    it(`${file}: no unquoted value contains ": " or " #" in a way YAML rejects`, () => {
      const lines = read(`.github/workflows/${file}`).split("\n");
      lines.forEach((line, i) => {
        const m = /^\s*(?:-\s+)?(name|description|group|if|run-name):\s+([^"'|>\s{\[&*!%@`].*)$/.exec(line);
        if (m && /:\s/.test(m[2] as string)) throw new Error(`${file}:${i + 1}: an unquoted value contains ": " (YAML parse error, the workflow would never run): ${line.trim()}`);
      });
    });
  }
});

describe("offline deployment package (Phase 2A)", () => {
  const sh = (file: string) => read(file);

  it("the installer never reaches for the network, npm, git or the Prisma CLI", () => {
    for (const file of ["deploy/install.sh", "deploy/rollback.sh", "deploy/verify.sh", "deploy/lib.sh", "deploy/configure-nginx.sh", ...readdirSync(join(ROOT, "deploy/bin")).map((f) => `deploy/bin/${f}`)]) {
      const code = sh(file).split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
      expect(code, file).not.toMatch(/\b(npm|npx|yarn|pnpm|git|wget|apt-get|apt|pip|prisma)\b\s/);
      expect(code, file).not.toMatch(/curl[^\n]*https?:\/\/(?!\$|"\$|\\\$|127\.0\.0\.1|localhost)/);
    }
  });

  it("only talks to the local application with curl (health checks)", () => {
    const uses = [...sh("deploy/lib.sh").matchAll(/curl [^\n]*/g)].map((m) => m[0]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toContain('"$1"');
  });

  it("verifies before it changes anything: archive checksum, file checksums, environment, dry-run, backup, then migrate", () => {
    const install = sh("deploy/install.sh");
    const order = ["ARCHIVE CHECKSUM MISMATCH", "FILE CHECKSUM MISMATCH", "config-check", "deploy --dry-run", "ops.mjs backup", "migrate.mjs deploy ) \\", "point_to_release \"$VERSION\"", "wait_ready"];
    let at = -1;
    for (const marker of order) {
      const i = install.indexOf(marker, at + 1);
      expect(i, marker).toBeGreaterThan(at);
      at = i;
    }
    expect(install).toContain("rolling the application back");
    expect(install).not.toMatch(/prisma migrate|migrate reset|DROP DATABASE|DROP TABLE/i);
  });

  it("rollback changes only the application: it checks the target's checksums and the schema, and never touches the database", () => {
    const rollback = sh("deploy/rollback.sh").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(rollback).toContain("sha256sum --check");
    expect(rollback).toContain("schema_check");
    expect(rollback).not.toMatch(/migrate\.mjs|deploy --dry-run|psql|pg_restore|pg_dump|DROP|TRUNCATE|DELETE FROM/i);
  });

  it("schema compatibility: rollback refuses by default, the override only ever covers one state, and the installer never uses it", () => {
    const rollback = sh("deploy/rollback.sh");
    const install = sh("deploy/install.sh");
    // refuses with distinct codes before switching anything
    expect(rollback.indexOf("schema_check")).toBeLessThan(rollback.indexOf("point_to_release"));
    expect(rollback).toMatch(/exit "\$SCHEMA_RC"/);
    // the override is honoured only for "newer unknown" (65), never for failed (66), missing (67) or undetermined (68)
    expect(rollback).toMatch(/\[ "\$SCHEMA_RC" = 65 \] && \[ "\$ACCEPT_NEWER" = 1 \]/);
    // the installer's automatic rollback checks compatibility first, never activates the previous release without it, and never mentions the override as an action
    const auto = install.slice(install.indexOf("warn \"release $VERSION is NOT healthy\""));
    expect(auto.indexOf("schema_check")).toBeGreaterThan(-1);
    expect(auto.indexOf("schema_check")).toBeLessThan(auto.indexOf("point_to_release"));
    expect(auto).toContain("MANUAL RECOVERY REQUIRED");
    expect(auto).toContain("die \"DEPLOYMENT FAILED");
    expect(install).not.toContain("ACCEPT_NEWER");
    // the only places that mention rollback.sh or the override are comments and warn messages (text for the person), never a command
    expect(install.split("\n").filter((l) => /rollback\.sh|accept-newer-schema/.test(l) && !/^\s*(warn |#)/.test(l))).toEqual([]);
  });

  it("verify.sh tells the four schema states apart and exits with their own codes", () => {
    const verify = sh("deploy/verify.sh");
    for (const marker of ["NEWER UNKNOWN MIGRATIONS", "FAILED MIGRATIONS", "MISSING MIGRATIONS", "UNDETERMINED", "SCHEMA_EXIT=65", "SCHEMA_EXIT=66", "SCHEMA_EXIT=67", "SCHEMA_EXIT=68"]) expect(verify, marker).toContain(marker);
  });

  it("the health check reports a database ahead of the release as an explicit warning, with counts and never names", () => {
    const runtime = read("server/runtime.ts");
    expect(runtime).toContain("schema ahead of this release");
    const message = runtime.slice(runtime.indexOf("schema ahead of this release"), runtime.indexOf("schema ahead of this release") + 260);
    expect(message).toContain("unknownToRelease.length");
    expect(message).not.toMatch(/unknownToRelease\.(join|map|\[)/);
    expect(read("server/maintenance/service.ts")).toContain('key: "schema.ahead"');
  });

  it("the migrator never reverses, drops or resets", () => {
    const code = read("server/db/migrate.ts").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/DROP (TABLE|SCHEMA|DATABASE)|TRUNCATE|DELETE FROM/i);
  });

  it("the release workflow is a manual/PR build whose rehearsal needs no network and which deploys nothing", () => {
    const wf = read(".github/workflows/release-package.yml");
    expect(wf).toContain("rehearse-offline-install.sh");
    expect(wf).toContain("workflow_dispatch");
    expect(wf).not.toMatch(/wrangler|cloudflare|ssh |scp |rsync|secrets\./i);
    expect(read("scripts/release/rehearse-offline-install.sh")).toContain("unshare --net");
  });

  it("the nginx templates expose only the two public media prefixes and never proxy the object store console or admin API", () => {
    const media = (read("deploy/nginx/media.conf.template") + read("deploy/nginx/s3-public.conf")).split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(media).toMatch(/\^~ \/images\//);
    expect(media).toMatch(/\^~ \/catalog\//);
    expect(media).toContain("proxy_pass_request_headers off");
    expect(media).not.toMatch(/9001|minio\/|console/i);
    expect(media).toMatch(/location \/ \{ return 404; \}/);
    expect(read("deploy/configure-nginx.sh")).toContain("upstreams must be loopback or private addresses");
  });

  it("the service and object-store units run unprivileged, hardened and bound to loopback", () => {
    const api = read("deploy/systemd/jaryan-api.service");
    expect(api).toMatch(/^User=jaryan$/m);
    for (const h of ["NoNewPrivileges=yes", "ProtectSystem=strict", "PrivateTmp=yes"]) expect(api).toContain(h);
    const minio = read("deploy/systemd/jaryan-minio.service");
    expect(minio).toContain("--address 127.0.0.1:9000");
    expect(minio).toContain("--console-address 127.0.0.1:9001");
    expect(read("deploy/env/minio.env.example")).toContain("MINIO_BROWSER=off");
    expect(read("deploy/env/api.env.example")).toContain("HOST=127.0.0.1");
    expect(read("deploy/env/api.env.example")).toContain("S3_ENDPOINT=http://127.0.0.1:9000");
  });

  it("no real secret is shipped in the templates", () => {
    for (const file of ["deploy/env/api.env.example", "deploy/env/minio.env.example"]) {
      const lines = read(file).split("\n").filter((l) => /^(DATABASE_URL|S3_SECRET_ACCESS_KEY|S3_ACCESS_KEY_ID|APP_ENCRYPTION_KEY|BACKUP_ENCRYPTION_KEY|MINIO_ROOT_PASSWORD|MINIO_ROOT_USER)=/.test(l));
      expect(lines.length, file).toBeGreaterThan(0);
      for (const l of lines) expect(l, l).toMatch(/CHANGE-ME/);
    }
  });
});
