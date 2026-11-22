import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { CreateMultipartUploadCommand } from "@aws-sdk/client-s3";
import { currentUser } from "@/lib/session";
import { insertFile, markFailed, setUploadId } from "@/lib/db";
import {
  S3_BUCKET,
  buildKey,
  classifyKind,
  partCountFor,
  partSizeFor,
  s3,
} from "@/lib/s3";

/** S3's hard ceiling for a single object. */
const MAX_OBJECT_BYTES = 5 * 1024 ** 4;

export async function POST(request: Request) {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { name?: unknown; size?: unknown; contentType?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const size = typeof body.size === "number" ? body.size : NaN;
  const contentType =
    typeof body.contentType === "string" && body.contentType ? body.contentType : null;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    // Zero-byte files are rejected rather than special-cased: S3 will not accept an
    // empty part, and an empty archive is not worth a code path.
    return NextResponse.json({ error: "size must be a positive integer" }, { status: 400 });
  }
  if (size > MAX_OBJECT_BYTES) {
    return NextResponse.json({ error: "file exceeds S3's 5 TiB object limit" }, { status: 400 });
  }
  if (!S3_BUCKET) {
    return NextResponse.json({ error: "AWS_S3_BUCKET is not configured" }, { status: 500 });
  }

  const fileId = randomUUID();
  const key = buildKey(fileId, name);
  const kind = classifyKind(contentType, name);

  insertFile({
    id: fileId,
    bucket: S3_BUCKET,
    key,
    name,
    contentType,
    kind,
    size,
  });

  const partSize = partSizeFor(size);
  const partCount = partCountFor(size, partSize);

  try {
    const created = await s3().send(
      new CreateMultipartUploadCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ContentType: contentType ?? undefined,
        StorageClass: "DEEP_ARCHIVE",
        ServerSideEncryption: "AES256",
        // Makes a per-part SHA-256 mandatory from here on: S3 verifies every chunk on
        // arrival and refuses to assemble the object from a bad one.
        ChecksumAlgorithm: "SHA256",
      }),
    );

    if (!created.UploadId) throw new Error("S3 returned no UploadId");
    setUploadId(fileId, created.UploadId);

    return NextResponse.json({
      fileId,
      key,
      uploadId: created.UploadId,
      partSize,
      partCount,
    });
  } catch (err) {
    markFailed(fileId);
    const message = err instanceof Error ? err.message : "failed to start upload";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
