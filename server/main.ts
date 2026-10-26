import { createServer } from "node:http";
import { ConfigError, loadConfig } from "./config";
import { createNodeHandler } from "./node-adapter";
import { createRuntime, jsonLogger as log } from "./runtime";

/** Admin API server. Run behind a TLS-terminating reverse proxy (see docs/admin/SELF-HOSTING.md). */
async function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const runtime = await createRuntime(config);
  const server = createServer(createNodeHandler(runtime.handle, { trustProxy: config.trustProxy, maxBodyBytes: 6 * 1024 * 1024, media: runtime.media }));
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;
  server.keepAliveTimeout = 5_000;

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  log("info", "listening", { host: config.host, port: config.port, mode: config.production ? "production" : "development" });

  let closing = false;
  const stop = async (signal: string) => {
    if (closing) return;
    closing = true;
    log("info", "shutting_down", { signal });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.shutdown();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

main().catch((error) => {
  log("error", "startup_failed", { error: error instanceof Error ? error.name : "unknown" });
  process.exit(1);
});
