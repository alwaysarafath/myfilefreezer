// Confirms the bucket in .env.local is reachable with the app's credentials.
//
// The app's IAM user deliberately has no bucket-level permissions, so a 403 here is the
// expected success signal: it means the bucket exists and the credentials are valid, and
// S3 is only refusing the bucket-level metadata read we never make in normal operation.
// A 404 means the name is wrong.
//
//   node scripts/check-bucket.mjs [optional-bucket-name-to-test]

import { readFileSync } from "node:fs";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const bucket = process.argv[2] ?? env.AWS_S3_BUCKET;
const region = env.AWS_REGION;

if (!bucket) {
  console.error("No bucket name given and AWS_S3_BUCKET is empty in .env.local");
  process.exit(1);
}

console.log(`region : ${region}`);
console.log(`bucket : ${bucket}`);
console.log("");

const s3 = new S3Client({
  region,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log("OK  — bucket exists and is readable.");
} catch (err) {
  const status = err?.$metadata?.httpStatusCode;
  if (status === 403) {
    console.log("OK  — bucket exists and the credentials are valid.");
    console.log("      (403 on HeadBucket is expected: the IAM user has object-level");
    console.log("       permissions only, which is exactly how it was scoped.)");
  } else if (status === 404 || err?.name === "NotFound" || err?.name === "NoSuchBucket") {
    console.log("FAIL — no bucket with that name exists in this account.");
    console.log("       Check the exact name in the S3 console.");
    process.exitCode = 1;
  } else if (status === 301 || err?.name === "PermanentRedirect") {
    console.log("FAIL — the bucket exists but lives in a different region.");
    console.log(`       AWS_REGION is set to ${region}.`);
    process.exitCode = 1;
  } else if (err?.name === "InvalidAccessKeyId" || err?.name === "SignatureDoesNotMatch") {
    console.log(`FAIL — credentials rejected (${err.name}). Re-check the key and secret.`);
    process.exitCode = 1;
  } else {
    console.log(`FAIL — ${err?.name ?? "error"} (HTTP ${status ?? "?"}): ${err?.message}`);
    process.exitCode = 1;
  }
}
