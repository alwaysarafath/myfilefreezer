// Rebuilds the local index (data/myfilefreezer.db) from what is actually in the bucket.
//
// The database is a cache over S3, not the source of truth. Lost it, deleted it, moved to a
// new laptop? Run this and /files repopulates from the objects themselves.
//
//   npm run reindex
//
// Safe to re-run: rows are upserted by S3 key. Requires s3:ListBucket on the bucket ARN
// (the bucket itself, not /*) -- see the IAM policy in the README.
//
// What cannot be recovered: the original filename is stored only in the local index, so
// rebuilt rows show the sanitised name from the key (e.g. "IMG_0001.HEIC" survives,
// "Beach day 🏖.jpg" comes back as "Beach_day.jpg"). Content type is not recovered either;
// photo/video is inferred from the extension.

import { existsSync } from "node:fs";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Imported after the env file is loaded so DB_PATH is honoured. Node runs the TypeScript
// directly (type stripping, Node 22.18+), which keeps one copy of the schema.
const { upsertFromS3 } = await import("../src/lib/db.ts");

const bucket = process.env.AWS_S3_BUCKET;
const region = process.env.AWS_REGION;
if (!bucket || !region) {
  console.error("AWS_S3_BUCKET and AWS_REGION must be set in .env.local");
  process.exit(1);
}

const s3 = new S3Client({ region });

// archive/<uuid>/<name>           -- what the upload route writes now
// u/<user-uuid>/<uuid>/<name>      -- the hosted v1 layout; same file uuid, extra user segment
const KEY_PATTERN = /^(?:archive|u\/[0-9a-f-]{36})\/([0-9a-f-]{36})\/(.+)$/i;

const PHOTO = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp", "dng", "raw", "cr2", "nef", "arw"]);
const VIDEO = new Set(["mp4", "mov", "m4v", "avi", "mkv", "webm", "mpg", "mpeg", "3gp", "hevc"]);
function kindOf(name) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return PHOTO.has(ext) ? "photo" : VIDEO.has(ext) ? "video" : "other";
}

let indexed = 0;
let skipped = 0;
const notDeepArchive = [];
let token;

console.log(`Reading s3://${bucket} (${region}) ...`);

do {
  let page;
  try {
    page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
  } catch (err) {
    if (err?.name === "AccessDenied" || err?.$metadata?.httpStatusCode === 403) {
      console.error(
        "\nAccess denied listing the bucket. The IAM policy needs s3:ListBucket on\n" +
          `  arn:aws:s3:::${bucket}\n` +
          "(the bucket ARN itself, without /*). See the IAM section of the README.",
      );
      process.exit(1);
    }
    throw err;
  }

  for (const obj of page.Contents ?? []) {
    const match = KEY_PATTERN.exec(obj.Key ?? "");
    if (!match) {
      skipped += 1;
      console.warn(`  skip  ${obj.Key} (not written by this app)`);
      continue;
    }
    const [, id, name] = match;
    // ListObjectsV2 reports DEEP_ARCHIVE explicitly; an absent class means STANDARD.
    const storageClass = obj.StorageClass ?? "STANDARD";
    const inDeepArchive = storageClass === "DEEP_ARCHIVE";
    if (!inDeepArchive) notDeepArchive.push(`${obj.Key} (${storageClass})`);

    upsertFromS3({
      id: id.toLowerCase(),
      bucket,
      key: obj.Key,
      name,
      kind: kindOf(name),
      size: Number(obj.Size ?? 0),
      storageClass,
      lastModified: (obj.LastModified ?? new Date()).toISOString(),
      etag: obj.ETag ?? null,
      status: "archived",
      safeToDelete: inDeepArchive,
    });
    indexed += 1;
  }

  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);

console.log(`\nIndexed ${indexed} object(s).${skipped ? ` Skipped ${skipped}.` : ""}`);
if (notDeepArchive.length > 0) {
  console.warn(
    `\n${notDeepArchive.length} object(s) are NOT in Deep Archive and were left unverified:\n` +
      notDeepArchive.map((k) => `  ${k}`).join("\n") +
      "\nThey are billed at a much higher storage rate. Check them in the S3 console.",
  );
}
