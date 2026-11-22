import { NextResponse } from "next/server";
import { AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { currentUser } from "@/lib/session";
import { getFile, markFailed } from "@/lib/db";
import { s3 } from "@/lib/s3";

export async function POST(request: Request) {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { fileId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  if (!fileId) return NextResponse.json({ error: "fileId is required" }, { status: 400 });

  const file = getFile(fileId);
  if (!file) return NextResponse.json({ error: "file not found" }, { status: 404 });

  if (file.upload_id) {
    try {
      await s3().send(
        new AbortMultipartUploadCommand({
          Bucket: file.s3_bucket,
          Key: file.s3_key,
          UploadId: file.upload_id,
        }),
      );
    } catch {
      // Best-effort. The bucket's AbortIncompleteMultipartUpload lifecycle rule is the
      // real guarantee that orphaned parts stop being billed.
    }
  }

  markFailed(fileId);
  return NextResponse.json({ ok: true });
}
