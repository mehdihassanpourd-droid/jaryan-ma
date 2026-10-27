/** Image helpers for the editor. Uploads go through the existing API (5 MB cap, JPEG/PNG/WebP only). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const TARGET_BYTES = 4_500_000;
export const MAX_SIDE = 2000;

export const mediaUrl = (base: string, key: string): string => `${base.replace(/\/+$/, "")}/${key}`;

/** Never fits an unsafe key into a URL: keys must look like `images/<id>/<id>.<ext>`. */
export const isSafeImageKey = (key: string): boolean => /^images\/[A-Za-z0-9-]{1,64}\/[A-Za-z0-9-]{1,64}\.(jpg|png|webp)$/.test(key);

export function fitWithin(width: number, height: number, maxSide = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export class ImageError extends Error {
  constructor(public code: "not_an_image" | "decode_failed" | "too_large") {
    super(code);
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Phone photos are often 8-12 MP and several MB. Decodes (honouring EXIF rotation), scales the long side down to
 * 2000 px and re-encodes as WebP (JPEG where WebP is unavailable) at the best quality that fits the upload limit.
 * Camera shots and gallery picks go through the same path.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; type: "image/webp" | "image/jpeg"; width: number; height: number }> {
  if (!file.type.startsWith("image/")) throw new ImageError("not_an_image");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageError("decode_failed");
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new ImageError("decode_failed");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  for (const type of ["image/webp", "image/jpeg"] as const) {
    for (const quality of [0.86, 0.74, 0.6, 0.45]) {
      const blob = await toBlob(canvas, type, quality);
      if (blob && blob.type === type && blob.size <= TARGET_BYTES) return { blob, type, width, height };
    }
  }
  throw new ImageError("too_large");
}
