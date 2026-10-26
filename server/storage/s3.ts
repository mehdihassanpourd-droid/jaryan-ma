import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
