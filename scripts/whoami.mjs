// Derives the AWS account ID from the access key in .env.local, offline.
//
// AWS access key IDs encode the owning account, so this answers "are my key and my
// bucket in the same account?" without needing any IAM permission at all.

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const key = env.AWS_ACCESS_KEY_ID ?? "";
if (key.length < 20) {
  console.error(`AWS_ACCESS_KEY_ID looks wrong (${key.length} chars, expected 20)`);
  process.exit(1);
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const trimmed = key.slice(4).toUpperCase();

let bits = 0n;
let count = 0;
for (const ch of trimmed) {
  const v = ALPHABET.indexOf(ch);
  if (v < 0) {
    console.error(`Unexpected character "${ch}" in access key.`);
    process.exit(1);
  }
  bits = (bits << 5n) | BigInt(v);
  count += 5;
}

// Keep the leading 48 bits, then drop the low 7 per AWS's encoding.
const top48 = bits >> BigInt(count - 48);
const accountId = (top48 & 0x7fffffffff80n) >> 7n;

console.log(`access key : ${key.slice(0, 8)}…`);
console.log(`account id : ${accountId}`);
console.log(`bucket     : ${env.AWS_S3_BUCKET}`);

const inBucket = (env.AWS_S3_BUCKET ?? "").match(/\d{12}/)?.[0];
if (inBucket) {
  console.log("");
  console.log(
    String(accountId) === inBucket
      ? "MATCH    — the key and the bucket name refer to the same account."
      : `MISMATCH — bucket name contains account ${inBucket}, but the key belongs to ${accountId}.`,
  );
}
