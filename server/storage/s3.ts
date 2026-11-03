import { CreateBucketCommand, DeleteObjectsCommand, GetBucketPolicyCommand, HeadBucketCommand, PutBucketPolicyCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ObjectStorage } from "../../src/domain/product/ports";

/** The only part of the AWS client we use; tests inject a fake. */
export interface S3Sender {
  send(command: PutObjectCommand | DeleteObjectsCommand): Promise<unknown>;
}

export interface S3Settings {
  /** Provider endpoint, e.g. a self-hosted MinIO or any S3-compatible service. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Most self-hosted/S3-compatible providers need path-style URLs. */
  forcePathStyle: boolean;
}

export function createS3Client(settings: S3Settings): S3Client {
  return new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  });
}

const DELETE_BATCH = 1000;

/**
 * S3-compatible object storage (MinIO, Ceph, any provider speaking the S3 API). Portable on purpose:
 * no provider-specific features. Public read access is configured on the bucket, not per object.
 */
export class S3Storage implements ObjectStorage {
  constructor(
    private readonly client: S3Sender,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Uint8Array | string, options: { contentType: string; cacheControl?: string }) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: typeof body === "string" ? new TextEncoder().encode(body) : body,
        ContentType: options.contentType,
        CacheControl: options.cacheControl,
      }),
    );
  }

  async delete(keys: string[]) {
    for (let i = 0; i < keys.length; i += DELETE_BATCH) {
      const batch = keys.slice(i, i + DELETE_BATCH);
      await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
    }
  }
}

// ---- bucket set-up for public media ---------------------------------------------------------------------

/** The only key prefixes that are ever public: product images and the published catalogue snapshots. */
export const PUBLIC_MEDIA_PREFIXES = ["images/", "catalog/"] as const;

/**
 * Least-privilege public-read policy: anonymous `GetObject` on the two public prefixes and NOTHING else (no listing, no
 * write, no other prefix). The reverse proxy repeats the same allow-list, so a mistake on one side does not expose a file.
 */
export function publicMediaPolicy(bucket: string): Record<string, unknown> {
  return {
    Version: "2012-10-17",
    Statement: [{ Sid: "PublicReadMedia", Effect: "Allow", Principal: { AWS: ["*"] }, Action: ["s3:GetObject"], Resource: PUBLIC_MEDIA_PREFIXES.map((p) => `arn:aws:s3:::${bucket}/${p}*`) }],
  };
}

export interface MediaSetupSender {
  send(command: HeadBucketCommand | CreateBucketCommand | PutBucketPolicyCommand | GetBucketPolicyCommand): Promise<{ Policy?: string }>;
}

const normalisePolicy = (value: unknown) => JSON.stringify(value, (_k, v: unknown) => (Array.isArray(v) ? [...v].sort() : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

/** Creates the bucket if it does not exist and applies the public-media policy. Idempotent. */
export async function configureMediaBucket(client: MediaSetupSender, bucket: string): Promise<{ created: boolean }> {
  let created = false;
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    created = true;
  }
  await client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(publicMediaPolicy(bucket)) }));
  return { created };
}

/** True when the bucket policy is exactly the least-privilege one (no extra grant, e.g. listing or a wider prefix). */
export async function mediaBucketPolicyIsExact(client: MediaSetupSender, bucket: string): Promise<boolean> {
  try {
    const { Policy } = await client.send(new GetBucketPolicyCommand({ Bucket: bucket }));
    return Policy !== undefined && normalisePolicy(JSON.parse(Policy)) === normalisePolicy(publicMediaPolicy(bucket));
  } catch {
    return false;
  }
}
