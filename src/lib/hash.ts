/**
 * SHA-256 of a Blob, base64-encoded -- the format S3 wants in x-amz-checksum-sha256.
 *
 * Deliberately per-chunk rather than whole-file. WebCrypto's digest() has no streaming
 * API, so hashing a 4 GB video in one go would mean holding all 4 GB in memory, which a
 * phone will not survive. Per-part is the stronger guarantee anyway: S3 verifies every
 * part on arrival and refuses to assemble an object from a bad one, so a corrupted upload
 * cannot silently succeed.
 *
 * Requires a secure context. localhost and HTTPS both qualify.
 */
export async function sha256Base64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
