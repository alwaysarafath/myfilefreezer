import { sha256Base64 } from "./hash";
import type { CreateUploadResponse } from "./types";

const CONCURRENCY = 4;
const MAX_ATTEMPTS = 4;

export class UploadError extends Error {
  status: number;
  detail: Record<string, unknown>;
  constructor(message: string, status: number, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "UploadError";
    this.status = status;
    this.detail = detail;
  }
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : res.statusText;
    throw new UploadError(message, res.status, data);
  }
  return data as T;
}

/**
 * PUT one chunk straight to S3.
 *
 * XHR rather than fetch: fetch has no upload progress event, so a bar driven by it only
 * moves at part boundaries, which on a two-part file looks like the upload has frozen.
 */
function putPart(
  url: string,
  blob: Blob,
  checksum: string,
  onBytes: (loaded: number) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("x-amz-checksum-sha256", checksum);

    xhr.upload.onprogress = (event) => onBytes(event.loaded);

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag");
        if (etag) {
          resolve(etag);
        } else {
          reject(
            new UploadError(
              "S3 accepted the chunk but the browser cannot read its ETag. Add \"ETag\" to the bucket's CORS ExposeHeaders.",
              0,
            ),
          );
        }
      } else {
        reject(new UploadError(`S3 rejected part (HTTP ${xhr.status})`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new UploadError("network error", 0));
    xhr.ontimeout = () => reject(new UploadError("timed out", 0));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));

    const abort = () => xhr.abort();
    signal.addEventListener("abort", abort, { once: true });
    xhr.onloadend = () => signal.removeEventListener("abort", abort);

    xhr.send(blob);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type UploadCallbacks = {
  /** Called with total bytes confirmed sent so far for this file. */
  onProgress?: (uploadedBytes: number) => void;
};

/**
 * Upload one file to Glacier Deep Archive as a resumable, checksummed multipart upload.
 *
 * Resume is per-part rather than per-file: because parts are independent, a dropped
 * connection only costs the chunks that were in flight. A 3 GB video that stalls at 80%
 * carries on from 80%. That is the whole of same-page resume, and it needs no persistence
 * -- closing the tab does discard the progress, by design.
 */
export async function uploadFile(
  file: File,
  signal: AbortSignal,
  callbacks: UploadCallbacks = {},
): Promise<void> {
  const created = await postJson<CreateUploadResponse>(
    "/api/uploads/create",
    { name: file.name, size: file.size, contentType: file.type || null },
    signal,
  );

  const { fileId, partSize, partCount } = created;
  const partLoaded = new Array<number>(partCount).fill(0);
  const results = new Array<{ partNumber: number; etag: string; checksumSha256: string }>(
    partCount,
  );

  const reportProgress = () => {
    if (!callbacks.onProgress) return;
    let total = 0;
    for (const n of partLoaded) total += n;
    callbacks.onProgress(Math.min(total, file.size));
  };

  async function uploadPart(index: number): Promise<void> {
    const partNumber = index + 1;
    const start = index * partSize;
    const blob = file.slice(start, Math.min(start + partSize, file.size));
    const checksum = await sha256Base64(blob);

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      signal.throwIfAborted();
      try {
        // Signed fresh on every attempt. URLs live an hour, and a retry after a long
        // stall is exactly the case where the original would have expired.
        const { url } = await postJson<{ url: string }>(
          "/api/uploads/sign-part",
          { fileId, partNumber, checksumSha256: checksum },
          signal,
        );

        partLoaded[index] = 0;
        const etag = await putPart(
          url,
          blob,
          checksum,
          (loaded) => {
            partLoaded[index] = loaded;
            reportProgress();
          },
          signal,
        );

        partLoaded[index] = blob.size;
        reportProgress();
        results[index] = { partNumber, etag, checksumSha256: checksum };
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        lastError = err;
        partLoaded[index] = 0;
        reportProgress();
        if (attempt < MAX_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new UploadError(`part ${partNumber} failed`, 0);
  }

  try {
    let next = 0;
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, partCount) },
      async () => {
        for (;;) {
          const index = next++;
          if (index >= partCount) return;
          await uploadPart(index);
        }
      },
    );
    await Promise.all(workers);

    await postJson("/api/uploads/complete", { fileId, parts: results }, signal);
  } catch (err) {
    // Deliberately not passing `signal`: on cancel it is already aborted, and this is the
    // request that tells S3 to throw the partial object away.
    await fetch("/api/uploads/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileId }),
      keepalive: true,
    }).catch(() => {});
    throw err;
  }
}
