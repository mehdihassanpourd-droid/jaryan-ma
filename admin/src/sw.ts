/**
 * Service worker: caches ONLY the static app shell (HTML, hashed JS/CSS, fonts, icons) so the installed app opens
 * instantly and shows a clear offline state. It never handles API or media requests (no `respondWith` for them), so
 * no product, customer or session data can ever be stored in a cache, and signing out leaves nothing to clear.
 */
declare const __PRECACHE__: string[];
declare const __VERSION__: string;

// Minimal typing of the worker scope (the DOM and webworker libraries cannot be loaded together in one project).
interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  respondWith(response: Response | Promise<Response>): void;
}
interface WorkerScope {
  location: Location;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEventLike) => void): void;
}
const scope = globalThis as unknown as WorkerScope;

const CACHE = `jm-admin-shell-${__VERSION__}`;
const SCOPE = "/admin/";

scope.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(__PRECACHE__))
      .then(() => scope.skipWaiting()),
  );
});

scope.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("jm-admin-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => scope.clients.claim()),
  );
});

scope.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Only same-origin files of the app itself. /api/, /media/ and everything else go straight to the network.
  if (url.origin !== scope.location.origin || !url.pathname.startsWith(SCOPE)) return;

  if (request.mode === "navigate") {
    // Always try the network first so a new release is picked up; fall back to the cached shell when offline.
    event.respondWith(fetch(request).catch(async () => (await caches.match(SCOPE)) ?? Response.error()));
    return;
  }
  if (url.pathname.startsWith(`${SCOPE}assets/`) || url.pathname.startsWith(`${SCOPE}icons/`)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) void caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
            return response;
          }),
      ),
    );
  }
});

export {};
