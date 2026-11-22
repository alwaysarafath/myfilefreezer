import { S3Client } from "@aws-sdk/client-s3";
import type { FileKind } from "./types";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const S3_BUCKET = process.env.AWS_S3_BUCKET ?? "";

let client: S3Client | null = null;

export function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: required("AWS_REGION"),
      credentials: {
        accessKeyId: required("AWS_ACCESS_KEY_ID"),
        secretAccessKey: required("AWS_SECRET_ACCESS_KEY"),
      },
      // We supply our own SHA-256 per part. Left on the default the SDK would also
      // inject a CRC32 header, which then has to be signed into every presigned URL
      // and sent by the browser -- extra failure surface for no extra guarantee.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

/** S3 allows at most 10,000 parts; 9,500 leaves headroom. 16 MiB covers ~152 GiB. */
const MIN_PART_SIZE = 16 * 1024 * 1024;
const MAX_PARTS = 9500;

export function partSizeFor(sizeBytes: number): number {
  const needed = Math.ceil(sizeBytes / MAX_PARTS);
  if (needed <= MIN_PART_SIZE) return MIN_PART_SIZE;
  // Round up to a whole MiB so part boundaries stay tidy.
  return Math.ceil(needed / (1024 * 1024)) * 1024 * 1024;
}

export function partCountFor(sizeBytes: number, partSize: number): number {
  return Math.max(1, Math.ceil(sizeBytes / partSize));
}

export function classifyKind(contentType: string | null, name: string): FileKind {
  const type = (contentType ?? "").toLowerCase();
  if (type.startsWith("image/")) return "photo";
  if (type.startsWith("video/")) return "video";

  // Browsers sometimes hand over an empty MIME type, especially on mobile.
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp", "dng", "raw", "cr2", "nef", "arw"].includes(ext)) {
    return "photo";
  }
  if (["mp4", "mov", "m4v", "avi", "mkv", "webm", "mpg", "mpeg", "3gp", "hevc"].includes(ext)) {
    return "video";
  }
  return "other";
}

/** Keeps the original name recognisable while making it safe as an S3 key segment. */
export function sanitizeName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const cleaned = base
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 180) || "file";
}

/**
 * `archive/<uuid>/<name>` -- the uuid segment means two uploads of IMG_0001.jpg never
 * collide, and the readable tail means you can still identify an object in the S3 console
 * without consulting the index.
 */
export function buildKey(fileId: string, name: string): string {
  return `archive/${fileId}/${sanitizeName(name)}`;
}
