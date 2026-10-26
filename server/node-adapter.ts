import type { IncomingMessage, ServerResponse } from "node:http";
import { CLIENT_IP_HEADER } from "./api";
import type { LocalDiskStorage } from "./storage/local-disk";

export interface AdapterOptions {
  /** Trust the proxy's X-Forwarded-For (only when a reverse proxy on the same host sets it). */
  trustProxy: boolean;
  maxBodyBytes: number;
  /** Development only: serves stored files at /media/* when local disk storage is used. */
  media?: LocalDiskStorage;
}

/** Real client address: the socket's, or (behind a trusted proxy) the last X-Forwarded-For entry. */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    const value = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
    const last = value?.split(",").pop()?.trim();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | "too_large"> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return "too_large";
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  res.end(body);
}

/** Bridges Node's HTTP server to the Fetch-style API handler. */
export function createNodeHandler(handle: (request: Request) => Promise<Response>, options: AdapterOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const method = req.method ?? "GET";
      let url: URL;
      try {
        url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      } catch {
        return send(res, 400, '{"error":"bad_request"}');
      }

      if (options.media && method === "GET" && url.pathname.startsWith("/media/")) {
        const file = await options.media.read(decodeURIComponent(url.pathname.slice("/media/".length)));
        if (!file) return send(res, 404, '{"error":"not_found"}');
        res.writeHead(200, { "content-type": file.contentType, "x-content-type-options": "nosniff", "cache-control": "no-cache", "access-control-allow-origin": "*" });
        return void res.end(file.body);
      }

      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined || name.toLowerCase() === CLIENT_IP_HEADER) continue; // never trust a client-supplied value
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      headers.set(CLIENT_IP_HEADER, clientIp(req, options.trustProxy));

      let body: Buffer | undefined;
      if (method !== "GET" && method !== "HEAD") {
        const declared = Number(req.headers["content-length"] ?? 0);
        if (declared > options.maxBodyBytes) return send(res, 413, '{"error":"payload_too_large"}');
        const read = await readBody(req, options.maxBodyBytes);
        if (read === "too_large") return send(res, 413, '{"error":"payload_too_large"}');
        body = read;
      }

      const response = await handle(new Request(url, { method, headers, body: body as unknown as BodyInit | undefined }));
      const out: Record<string, string | string[]> = {};
      response.headers.forEach((value, name) => {
        if (name !== "set-cookie") out[name] = value;
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) out["set-cookie"] = cookies;
      res.writeHead(response.status, out);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) send(res, 500, '{"error":"internal_error"}');
      else res.end();
    }
  };
}
