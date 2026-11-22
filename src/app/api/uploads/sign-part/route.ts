import { NextResponse } from "next/server";
import { UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { currentUser } from "@/lib/session";
import { getFile } from "@/lib/db";
import { s3 } from "@/lib/s3";

const URL_TTL_SECONDS = 3600;
const BASE64_SHA256 = /^[A-Za-z0-9+/]{43}=$/;

export async function POST(request: Request) {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { fileId?: unknown; partNumber?: unknown; checksumSha256?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  const partNumber = typeof body.partNumber === "number" ? body.partNumber : NaN;
  const checksum = typeof body.checksumSha256 === "string" ? body.checksumSha256 : "";

  if (!fileId) return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return NextResponse.json({ error: "partNumber must be 1-10000" }, { status: 400 });
  }
  if (!BASE64_SHA256.test(checksum)) {
    return NextResponse.json({ error: "checksumSha256 must be base64 SHA-256" }, { status: 400 });
  }

  const file = getFile(fileId);
  if (!file) return NextResponse.json({ error: "file not found" }, { status: 404 });
  if (file.status !== "uploading" || !file.upload_id) {
    return NextResponse.json({ error: "upload is not in progress" }, { status: 409 });
  }

  const url = await getSignedUrl(
    s3(),
    new UploadPartCommand({
      Bucket: file.s3_bucket,
      Key: file.s3_key,
      UploadId: file.upload_id,
      PartNumber: partNumber,
      ChecksumSHA256: checksum,
    }),
    {
      expiresIn: URL_TTL_SECONDS,
      // Keep the checksum as a signed *header* instead of letting the presigner hoist it
      // into the query string. S3 only validates the chunk if the header arrives with the
      // body, and binding it to the signature means the browser cannot swap in a hash for
      // different bytes.
      unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
    },
  );

  return NextResponse.json({ url });
}
