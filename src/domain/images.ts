export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";
const EXTENSIONS: Record<ImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Detects the real type from magic bytes; the declared Content-Type is never trusted. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "image/png";
  const ascii = (from: number, text: string) => [...text].every((ch, i) => bytes[from + i] === ch.charCodeAt(0));
  if (bytes.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

export type ImageCheck =
  | { ok: true; type: ImageType; extension: string }
  | { ok: false; code: "empty" | "too_large" | "unsupported_type" | "type_mismatch" };

export function validateImageUpload(
  bytes: Uint8Array,
  declaredType: string | null,
  maxBytes = MAX_IMAGE_BYTES,
): ImageCheck {
  if (bytes.length === 0) return { ok: false, code: "empty" };
  if (bytes.length > maxBytes) return { ok: false, code: "too_large" };
  const type = sniffImageType(bytes);
  if (!type) return { ok: false, code: "unsupported_type" };
  if (declaredType && declaredType.split(";")[0]?.trim().toLowerCase() !== type) {
    return { ok: false, code: "type_mismatch" };
  }
  return { ok: true, type, extension: EXTENSIONS[type] };
}

/** Unguessable object key: `images/<productId>/<uuid>.<ext>`. */
export function buildImageKey(productId: string, uuid: string, extension: string): string {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(productId) || !/^[A-Za-z0-9-]{1,64}$/.test(uuid)) {
    throw new Error("invalid_image_key_part");
  }
  return `images/${productId}/${uuid}.${extension}`;
}
