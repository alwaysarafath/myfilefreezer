import AppShell from "@/components/AppShell";
import ThawEstimator, { type ThawFile } from "@/components/ThawEstimator";
import { listArchived } from "@/lib/db";
import { PRICING_LAST_CHECKED, PRICING_URL, pricingFor } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default async function ThawPage() {
  const { pricing, requested, isFallback } = pricingFor(process.env.AWS_REGION);

  const files: ThawFile[] = listArchived().map((f) => ({
    id: f.id,
    name: f.original_name,
    size: Number(f.size_bytes),
    archivedAt: f.archived_at ?? f.created_at,
  }));

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl flex-1 p-5">
        <h1 className="text-lg font-semibold">What would a thaw cost?</h1>
        <p className="mt-1 max-w-2xl text-sm opacity-70">
          Select files to see what restoring them from Deep Archive and downloading them would
          cost. This is an estimate only — nothing on this page starts a restore.
        </p>

        {isFallback && (
          <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            No pricing on file for region <code>{requested}</code>, so these figures use{" "}
            <code>{pricing.region}</code> rates. Most other regions cost more, so treat the
            estimate as a lower bound.
          </p>
        )}

        <div className="mt-6">
          <ThawEstimator files={files} pricing={pricing} />
        </div>

        <p className="mt-6 text-xs opacity-50">
          Estimate for {pricing.region}, AWS list prices checked {PRICING_LAST_CHECKED}.
          Excludes tax and any discounts on your account.{" "}
          <a href={PRICING_URL} className="underline" target="_blank" rel="noreferrer">
            AWS S3 pricing
          </a>
        </p>
      </main>
    </AppShell>
  );
}
