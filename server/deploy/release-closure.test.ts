import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Closure = {
  packageNameOf(specifier: string): string;
  externalPackagesFromMetafile(meta: { outputs: Record<string, { imports?: Array<{ path: string; external?: boolean }> }> }): string[];
  collectClosure(names: string[], options: { root: string; exclude?: string[] }): { packages: Array<{ name: string; rel: string; version: string }>; missing: string[] };
};
// the builder script is plain JavaScript (it runs where TypeScript tooling may not be built); import it by a computed path
const closurePath = join(import.meta.dirname, "..", "..", "scripts", "release", "closure.mjs");
const load = async (): Promise<Closure> => (await import(/* @vite-ignore */ closurePath)) as Closure;

let root: string;
const pkg = (dir: string, json: Record<string, unknown>) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(json));
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "jm-closure-"));
  const nm = join(root, "node_modules");
  pkg(join(nm, "app-dep"), { name: "app-dep", version: "1.0.0", dependencies: { shared: "^1", "@scope/inner": "^2" }, optionalDependencies: { "native-missing": "*", "native-present": "*" } });
  pkg(join(nm, "shared"), { name: "shared", version: "1.2.3" });
  pkg(join(nm, "@scope", "inner"), { name: "@scope/inner", version: "2.0.0", dependencies: { shared: "^1" }, peerDependencies: { "peer-ok": "*", "peer-optional": "*" }, peerDependenciesMeta: { "peer-optional": { optional: true } } });
  pkg(join(nm, "peer-ok"), { name: "peer-ok", version: "1.0.0" });
  pkg(join(nm, "native-present"), { name: "native-present", version: "1.0.0" });
  // a nested copy of "shared" at another version that only "nested-user" should see
  pkg(join(nm, "nested-user"), { name: "nested-user", version: "1.0.0", dependencies: { shared: "^9" } });
  pkg(join(nm, "nested-user", "node_modules", "shared"), { name: "shared", version: "9.0.0" });
  pkg(join(nm, "dev-only"), { name: "dev-only", version: "1.0.0" });
  pkg(join(nm, "uses-dev"), { name: "uses-dev", version: "1.0.0", dependencies: { "dev-only": "*" } });
  pkg(join(nm, "broken"), { name: "broken", version: "1.0.0", dependencies: { "does-not-exist": "*" } });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("release dependency closure (works from installed node_modules, no registry)", () => {
  it("maps import specifiers to package names", async () => {
    const { packageNameOf } = await load();
    expect(packageNameOf("zod")).toBe("zod");
    expect(packageNameOf("zod/v4")).toBe("zod");
    expect(packageNameOf("@aws-sdk/client-s3")).toBe("@aws-sdk/client-s3");
    expect(packageNameOf("@prisma/client/runtime/client")).toBe("@prisma/client");
  });

  it("takes only external, non-builtin imports from an esbuild metafile", async () => {
    const { externalPackagesFromMetafile } = await load();
    const meta = { outputs: { "a.mjs": { imports: [{ path: "node:fs", external: true }, { path: "pg", external: true }, { path: "./x.js" }, { path: "@prisma/client/runtime/client", external: true }, { path: "zod", external: true }] }, "b.mjs": { imports: [{ path: "pg", external: true }] } } };
    expect(externalPackagesFromMetafile(meta)).toEqual(["@prisma/client", "pg", "zod"]);
  });

  it("follows dependencies, optional dependencies and non-optional peers the way Node resolves them", async () => {
    const { collectClosure } = await load();
    const r = collectClosure(["app-dep"], { root });
    expect(r.packages.map((p) => p.rel)).toEqual(["node_modules/@scope/inner", "node_modules/app-dep", "node_modules/native-present", "node_modules/peer-ok", "node_modules/shared"]);
    expect(r.missing).toEqual([]); // a missing OPTIONAL dependency and an optional peer are fine
  });

  it("resolves a nested copy for the package that has it, and the top-level one for the others", async () => {
    const { collectClosure } = await load();
    const rels = collectClosure(["nested-user", "app-dep"], { root }).packages.map((p) => `${p.rel}@${p.version}`);
    expect(rels).toContain("node_modules/nested-user/node_modules/shared@9.0.0");
    expect(rels).toContain("node_modules/shared@1.2.3");
  });

  it("honours exclusions and reports a missing REQUIRED dependency", async () => {
    const { collectClosure } = await load();
    expect(collectClosure(["uses-dev"], { root, exclude: ["dev-only"] }).packages.map((p) => p.name)).toEqual(["uses-dev"]);
    expect(collectClosure(["broken"], { root }).missing).toEqual(["does-not-exist"]);
    expect(collectClosure(["not-installed"], { root }).missing).toEqual(["not-installed"]);
  });
});
