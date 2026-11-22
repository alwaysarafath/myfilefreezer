import Link from "next/link";
import AppShell from "@/components/AppShell";
import { listFiles, totalsByKind, usedBytes } from "@/lib/db";
import { formatBytes, formatDate, formatUsd } from "@/lib/format";
import { monthlyStorageCost, pricingFor } from "@/lib/pricing";
import type { FileKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<FileKind, string> = {
  photo: "Photos",
  video: "Videos",
  other: "Other",
};

export default async function FilesPage() {
  const totals = totalsByKind();
  const files = listFiles();
  const used = usedBytes();
  const { pricing } = pricingFor(process.env.AWS_REGION);

  const grandCount = totals.reduce((n, t) => n + Number(t.file_count), 0);
  const grandBytes = totals.reduce((n, t) => n + Number(t.total_bytes), 0);

  const tiles = [
    ...(["photo", "video", "other"] as FileKind[]).map((kind) => {
      const row = totals.find((t) => t.file_kind === kind);
      return {
        label: KIND_LABELS[kind],
        count: Number(row?.file_count ?? 0),
        bytes: Number(row?.total_bytes ?? 0),
      };
    }),
    { label: "Total", count: grandCount, bytes: grandBytes },
  ];

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-3xl flex-1 p-5">
        <p className="mb-6 text-xs opacity-60">
          {formatBytes(used)} archived — roughly{" "}
          <strong className="font-medium">
            {formatUsd(monthlyStorageCost(used, pricing))}
          </strong>{" "}
          per month in Deep Archive storage.
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-lg border border-current/10 p-3">
              <div className="text-xs opacity-60">{tile.label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {formatBytes(tile.bytes)}
              </div>
              <div className="text-xs opacity-50 tabular-nums">
                {tile.count} {tile.count === 1 ? "file" : "files"}
              </div>
            </div>
          ))}
        </div>

        <h2 className="mt-8 mb-2 text-sm font-semibold">Archived files</h2>

        {files.length === 0 ? (
          <p className="rounded-lg border border-current/10 p-8 text-center text-sm opacity-60">
            Nothing archived yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-current/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-current/10 text-left text-xs opacity-60">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 text-right font-medium">Size</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id} className="border-b border-current/5 last:border-0">
                    <td className="max-w-[18rem] truncate px-3 py-2">
                      {file.original_name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs opacity-60">
                      {formatDate(file.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums opacity-80">
                      {formatBytes(Number(file.size_bytes))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {file.status === "archived" && file.safe_to_delete ? (
                        <span className="text-green-600">Verified</span>
                      ) : file.status === "archived" ? (
                        <span className="opacity-60">Archived</span>
                      ) : (
                        <span className="opacity-60">Uploading…</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs opacity-50">
          These are in Glacier Deep Archive, so there are no previews and no downloads here.
          Getting one back means a restore request taking about 12 hours (Standard) or 48
          hours (Bulk), and it costs money —{" "}
          <Link href="/thaw" className="underline">
            estimate it first
          </Link>
          . Thaw is the worst case. It ignores the 100 GB of free internet download AWS gives
          each account per month, so a small thaw can cost less than shown.
        </p>
      </main>
    </AppShell>
  );
}
