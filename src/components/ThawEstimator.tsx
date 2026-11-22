"use client";

import { useMemo, useState } from "react";
import { formatBytes, formatDate, formatUsd } from "@/lib/format";
import {
  TIERS,
  estimateThaw,
  restoredCopyPerDay,
  type RegionPricing,
  type Tier,
} from "@/lib/pricing";

export type ThawFile = {
  id: string;
  name: string;
  size: number;
  archivedAt: string;
};

const TIER_ORDER: Tier[] = ["bulk", "standard"];

export default function ThawEstimator({
  files,
  pricing,
}: {
  files: ThawFile[];
  pricing: RegionPricing;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const selection = useMemo(() => {
    let bytes = 0;
    let fileCount = 0;
    for (const f of files) {
      if (selected.has(f.id)) {
        bytes += f.size;
        fileCount += 1;
      }
    }
    return { bytes, fileCount };
  }, [files, selected]);

  const estimates = useMemo(
    () =>
      Object.fromEntries(
        TIER_ORDER.map((tier) => [tier, estimateThaw(selection, pricing, tier)]),
      ) as Record<Tier, ReturnType<typeof estimateThaw>>,
    [selection, pricing],
  );

  const allSelected = files.length > 0 && selected.size === files.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(files.map((f) => f.id)));
  }

  const rows: { label: string; key: "retrieval" | "requests" | "transfer" }[] = [
    { label: "Retrieval", key: "retrieval" },
    { label: "Requests", key: "requests" },
    { label: "Transfer out", key: "transfer" },
  ];

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
      <div className="min-w-0">
        {files.length === 0 ? (
          <p className="rounded-lg border border-current/10 p-8 text-center text-sm opacity-60">
            Nothing archived yet, so nothing to thaw.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-current/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-current/10 text-left text-xs opacity-60">
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Archived</th>
                  <th className="px-3 py-2 text-right font-medium">Size</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr
                    key={file.id}
                    onClick={() => toggle(file.id)}
                    className={`cursor-pointer border-b border-current/5 last:border-0 ${
                      selected.has(file.id) ? "bg-current/5" : "hover:bg-current/[0.03]"
                    }`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${file.name}`}
                        checked={selected.has(file.id)}
                        onChange={() => toggle(file.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="max-w-[16rem] truncate px-3 py-2">{file.name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs opacity-60">
                      {formatDate(file.archivedAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums opacity-80">
                      {formatBytes(file.size)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <aside className="h-fit rounded-lg border border-current/10 p-4 text-sm md:sticky md:top-5">
        <p className="text-xs opacity-70">
          Selected:{" "}
          <span className="tabular-nums">
            {selection.fileCount} {selection.fileCount === 1 ? "file" : "files"} ·{" "}
            {formatBytes(selection.bytes)}
          </span>
        </p>

        <table className="mt-4 w-full tabular-nums">
          <thead>
            <tr className="text-xs opacity-60">
              <th />
              {TIER_ORDER.map((tier) => (
                <th key={tier} className="pb-1 text-right font-medium">
                  {TIERS[tier].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="py-0.5 text-xs opacity-70">{row.label}</td>
                {TIER_ORDER.map((tier) => (
                  <td key={tier} className="py-0.5 text-right">
                    {formatUsd(estimates[tier][row.key])}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-current/15 font-semibold">
              <td className="pt-1.5 text-xs">Estimated</td>
              {TIER_ORDER.map((tier) => (
                <td key={tier} className="pt-1.5 text-right">
                  {formatUsd(estimates[tier].total)}
                </td>
              ))}
            </tr>
            <tr className="text-xs opacity-60">
              <td className="pt-1">Wait</td>
              {TIER_ORDER.map((tier) => (
                <td key={tier} className="pt-1 text-right">
                  {TIERS[tier].wait}
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        <div className="mt-4 space-y-2 text-xs opacity-50">
          <p>
            Transfer out is usually the biggest line. The first 100 GB a month across your
            whole AWS account is free, so a small thaw may cost less than shown.
          </p>
          <p>
            While a restored copy is available it is billed as S3 Standard storage — about{" "}
            {formatUsd(restoredCopyPerDay(selection.bytes, pricing))} per day for this
            selection.
          </p>
        </div>
      </aside>
    </div>
  );
}
