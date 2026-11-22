import { NextResponse } from "next/server";
import { CompleteMultipartUploadCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { currentUser } from "@/lib/session";
import { getFile, markArchived, markFailed } from "@/lib/db";
import { s3 } from "@/lib/s3";

type PartInput = { partNumber: number; etag: string; checksumSha256: string };

function parseParts(raw: unknown): PartInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const parts: PartInput[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const { partNumber, etag, checksumSha256 } = item as Record<string, unknown>;
    if (
      typeof partNumber !== "number" ||
      !Number.isInteger(partNumber) ||
      typeof etag !== "string" ||
      !etag ||
      typeof checksumSha256 !== "string" ||
      !checksumSha256
    ) {
      return null;
    }
    parts.push({ partNumber, etag, checksumSha256 });
  }
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

export async function POST(request: Request) {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { fileId?: unknown; parts?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  const parts = parseParts(body.parts);
  if (!fileId) return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  if (!parts) return NextResponse.json({ error: "parts is malformed" }, { status: 400 });

  const file = getFile(fileId);
  if (!file) return NextResponse.json({ error: "file not found" }, { status: 404 });
  if (file.status !== "uploading" || !file.upload_id) {
    return NextResponse.json({ error: "upload is not in progress" }, { status: 409 });
  }

  try {
    const completed = await s3().send(
      new CompleteMultipartUploadCommand({
        Bucket: file.s3_bucket,
        Key: file.s3_key,
        UploadId: file.upload_id,
        MultipartUpload: {
          Parts: parts.map((p) => ({
            PartNumber: p.partNumber,
            ETag: p.etag,
            ChecksumSHA256: p.checksumSha256,
          })),
        },
      }),
    );

    // Verify rather than assume. This is what earns safe_to_delete: the object is read
    // back from S3 and checked, because safe_to_delete is the flag telling you it is fine
    // to wipe the only other copy off your phone.
    const head = await s3().send(
      new HeadObjectCommand({ Bucket: file.s3_bucket, Key: file.s3_key }),
    );

    if (head.ContentLength !== file.size_bytes) {
      throw new Error(
        `size mismatch: S3 has ${head.ContentLength} bytes, expected ${file.size_bytes}`,
      );
    }
    // S3 omits StorageClass entirely for STANDARD objects, so this also catches the quiet
    // failure where DEEP_ARCHIVE was requested but not applied and the object is silently
    // billed at the standard rate -- roughly 23x the cost.
    if (head.StorageClass !== "DEEP_ARCHIVE") {
      throw new Error(
        `storage class is ${head.StorageClass ?? "STANDARD"}, expected DEEP_ARCHIVE`,
      );
    }

    markArchived(fileId, {
      etag: completed.ETag ?? null,
      checksum: completed.ChecksumSHA256 ?? null,
    });

    return NextResponse.json({ ok: true, verified: true });
  } catch (err) {
    markFailed(fileId);
    const message = err instanceof Error ? err.message : "failed to complete upload";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
