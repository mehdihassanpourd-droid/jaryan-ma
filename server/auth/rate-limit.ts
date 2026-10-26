/** Sliding-window rate limiter held in memory (single server process; see docs for multi-instance notes). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly clock: () => number = Date.now) {}

  /** Records an attempt and reports whether it is within `limit` per `windowMs`. */
  hit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.clock();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.sweep(windowMs, now);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private sweep(windowMs: number, now: number) {
    for (const [key, times] of this.hits) if (times.every((t) => now - t >= windowMs)) this.hits.delete(key);
  }
}
