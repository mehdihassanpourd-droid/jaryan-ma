import type { D1DatabaseLike, R2BucketLike } from "./d1";

export interface Env {
  DB: D1DatabaseLike;
  /** Public bucket: image originals and catalogue snapshots. Never put private files here. */
  BUCKET: R2BucketLike;
  /** e.g. `myteam.cloudflareaccess.com`. Admin routes refuse to work without it. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Audience (AUD) tag of the Cloudflare Access application protecting this Worker. */
  ACCESS_AUD?: string;
  /** Comma separated origins allowed to send state-changing requests, e.g. `https://admin.example.com`. */
  ADMIN_ORIGINS?: string;
  /** Public base URL of the bucket (custom domain), used to build image URLs in snapshots. */
  PUBLIC_BUCKET_URL?: string;
  /** Max products per CSV import request (default 10, sized for the free plan). */
  IMPORT_CHUNK_MAX?: string;
}
