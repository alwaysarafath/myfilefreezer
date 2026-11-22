"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import UploadPreview from "./UploadPreview";
import { UploadError, uploadFile } from "@/lib/upload";
import { formatBytes, formatUsd } from "@/lib/format";
import { monthlyStorageCost, type RegionPricing } from "@/lib/pricing";

type ItemStatus = "queued" | "uploading" | "done" | "failed";

type Item = {
  id: string;
  file: File;
  status: ItemStatus;
  uploaded: number;
  error?: string;
  controller: AbortController;
};

export default function UploadDropzone({
  usedBytes,
  pricing,
}: {
  usedBytes: number;
  pricing: RegionPricing;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [used, setUsed] = useState(usedBytes);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const itemsRef = useRef<Item[]>([]);
  const runningRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = useCallback((next: Item[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const patch = useCallback(
    (id: string, changes: Partial<Item>) => {
      commit(itemsRef.current.map((i) => (i.id === id ? { ...i, ...changes } : i)));
    },
    [commit],
  );

  const dismiss = useCallback(
    (id: string) => commit(itemsRef.current.filter((i) => i.id !== id)),
    [commit],
  );

  const drain = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === "queued");
        if (!next) break;

        patch(next.id, { status: "uploading", uploaded: 0 });
        try {
          await uploadFile(next.file, next.controller.signal, {
            onProgress: (bytes) => patch(next.id, { uploaded: bytes }),
          });
          // Finished rows stay until the user dismisses them. The thumbnail is still the
          // in-memory File, not something fetched back from S3 -- Deep Archive could not
          // serve it, and nothing here pretends otherwise.
          patch(next.id, { status: "done", uploaded: next.file.size });
          setUsed((u) => u + next.file.size);
          router.refresh();
        } catch (err) {
          const aborted = err instanceof DOMException && err.name === "AbortError";
          let message = aborted ? "Cancelled" : "Upload failed";
          if (err instanceof UploadError) {
            message = err.message;
          } else if (err instanceof Error && !aborted) {
            message = err.message;
          }
          patch(next.id, { status: "failed", error: message, uploaded: 0 });
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [patch, router]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      setNotice(null);
      const incoming = Array.from(files);
      if (incoming.length === 0) return;

      // No quota: you pay Amazon directly, and an AWS billing alarm (see the README) is
      // the spending guard, since it can see your whole bill and this app cannot.
      const accepted: Item[] = [];
      const rejected: string[] = [];

      for (const file of incoming) {
        if (file.size === 0) {
          rejected.push(`${file.name} (empty)`);
          continue;
        }
        accepted.push({
          id: crypto.randomUUID(),
          file,
          status: "queued",
          uploaded: 0,
          controller: new AbortController(),
        });
      }

      if (rejected.length > 0) {
        setNotice(`Skipped ${rejected.length}: ${rejected.slice(0, 3).join(", ")}`);
      }
      if (accepted.length > 0) {
        commit([...itemsRef.current, ...accepted]);
        void drain();
      }
    },
    [commit, drain],
  );

  const doneCount = items.filter((i) => i.status === "done").length;

  return (
    <div className="mx-auto w-full max-w-2xl p-5">
      <p className="mb-5 text-xs opacity-70">
        {formatBytes(used)} in your bucket — about{" "}
        <span className="font-medium">{formatUsd(monthlyStorageCost(used, pricing))}</span>{" "}
        a month in Deep Archive.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
          dragging ? "border-current/40 bg-current/5" : "border-current/15"
        }`}
      >
        <p className="text-sm font-medium">Choose photos or videos</p>
        <p className="mt-1 text-xs opacity-60">
          or drag them here. They go straight to deep archive.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {notice && <p className="mt-3 text-xs text-amber-500">{notice}</p>}

      {doneCount > 1 && (
        <div className="mt-5 flex items-center justify-between">
          <p className="text-xs opacity-70">
            {doneCount} files archived and verified.
          </p>
          <button
            onClick={() => commit(itemsRef.current.filter((i) => i.status !== "done"))}
            className="text-xs opacity-70 hover:opacity-100 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      <ul className="mt-5 space-y-2.5">
        {items.map((item) => {
          const pctDone =
            item.status === "done"
              ? 100
              : Math.min(100, (item.uploaded / item.file.size) * 100);
          return (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-md border border-current/10 p-2.5"
            >
              <UploadPreview file={item.file} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm">{item.file.name}</span>
                  <span className="shrink-0 text-xs opacity-50">
                    {formatBytes(item.file.size)}
                  </span>
                </div>

                {item.status === "failed" ? (
                  <p className="mt-1 text-xs text-red-500">{item.error}</p>
                ) : item.status === "done" ? (
                  <p className="mt-1 text-xs text-green-600">
                    Archived and verified — safe to delete from this device
                  </p>
                ) : (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-current/10">
                    <div
                      className="h-full bg-current/50 transition-[width] duration-150"
                      style={{ width: `${pctDone}%` }}
                    />
                  </div>
                )}
              </div>

              {(item.status === "queued" || item.status === "uploading") && (
                <button
                  onClick={() => item.controller.abort()}
                  className="shrink-0 text-xs opacity-60 hover:opacity-100 hover:underline"
                >
                  Cancel
                </button>
              )}
              {item.status === "done" && (
                <button
                  onClick={() => dismiss(item.id)}
                  className="shrink-0 rounded border border-current/20 px-2.5 py-1 text-xs hover:bg-current/5"
                >
                  Done
                </button>
              )}
              {item.status === "failed" && (
                <button
                  onClick={() => {
                    patch(item.id, {
                      status: "queued",
                      error: undefined,
                      controller: new AbortController(),
                    });
                    void drain();
                  }}
                  className="shrink-0 text-xs opacity-60 hover:opacity-100 hover:underline"
                >
                  Retry
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
