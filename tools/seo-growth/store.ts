import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DATE, dayDataSchema, type DayData } from "./types";

/** How many rows per day are kept (the highest-impression ones): bounds the history's size on the data branch. */
export const MAX_PAGE_ROWS = 1000;
export const MAX_QUERY_ROWS = 3000;

/**
 * Historical metrics on disk: one JSON file per day (`days/YYYY-MM-DD.json`). Writing the same day again REPLACES the file, with
 * deterministic ordering and formatting, so a re-run produces byte-identical output (no new commit, no duplicate rows). Files of a
 * different `source` are never overwritten by each other: fixture data lives in its own directory chosen by the caller.
 */
export class FileMetricsStore {
  constructor(private readonly dir: string) {}

  private file(date: string) {
    if (!DATE.test(date)) throw new Error("invalid_date");
    return join(this.dir, "days", `${date}.json`);
  }

  async putDay(day: DayData): Promise<"written" | "unchanged"> {
    const normal: DayData = {
      ...day,
      pages: [...day.pages].sort((a, b) => b.impressions - a.impressions || (a.page < b.page ? -1 : 1)).slice(0, MAX_PAGE_ROWS).sort((a, b) => (a.page < b.page ? -1 : 1)),
      queries: [...day.queries]
        .sort((a, b) => b.impressions - a.impressions || (a.page + a.query < b.page + b.query ? -1 : 1))
        .slice(0, MAX_QUERY_ROWS)
        .sort((a, b) => (a.page + "\u0000" + a.query < b.page + "\u0000" + b.query ? -1 : 1)),
    };
    const text = `${JSON.stringify(normal, null, 1)}\n`;
    const file = this.file(day.date);
    const existing = await readFile(file, "utf8").catch(() => null);
    // `fetchedAt` is when we looked, not what we saw: an identical re-fetch must not rewrite the file.
    if (existing !== null) {
      const before = JSON.parse(existing) as DayData;
      if (JSON.stringify({ ...before, fetchedAt: "" }) === JSON.stringify({ ...normal, fetchedAt: "" })) return "unchanged";
    }
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, file);
    return "written";
  }

  async getDay(date: string): Promise<DayData | null> {
    const text = await readFile(this.file(date), "utf8").catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? null : Promise.reject(e)));
    if (text === null) return null;
    return dayDataSchema.parse(JSON.parse(text));
  }

  async listDates(): Promise<string[]> {
    const names = await readdir(join(this.dir, "days")).catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? [] : Promise.reject(e)));
    return names.filter((n) => n.endsWith(".json") && DATE.test(n.slice(0, -5))).map((n) => n.slice(0, -5)).sort();
  }

  /** The stored days within `[start, end]` (missing days are simply absent: callers report coverage). */
  async range(start: string, end: string): Promise<DayData[]> {
    const out: DayData[] = [];
    for (const date of await this.listDates()) if (date >= start && date <= end) out.push((await this.getDay(date)) as DayData);
    return out;
  }

  /** Writes any other derived JSON/text artefact (audits, reports) under the data directory, atomically. */
  async putArtifact(relativePath: string, content: string): Promise<"written" | "unchanged"> {
    if (relativePath.includes("..") || relativePath.startsWith("/")) throw new Error("invalid_path");
    const file = join(this.dir, relativePath);
    const existing = await readFile(file, "utf8").catch(() => null);
    if (existing === content) return "unchanged";
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, file);
    return "written";
  }

  async readArtifact(relativePath: string): Promise<string | null> {
    if (relativePath.includes("..") || relativePath.startsWith("/")) throw new Error("invalid_path");
    return readFile(join(this.dir, relativePath), "utf8").catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? null : Promise.reject(e)));
  }
}
