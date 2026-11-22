/**
 * What a thaw would cost, before you ask for one.
 *
 * Every figure below was taken from AWS's machine-readable price list (the
 * `AmazonS3GlacierDeepArchive`, `AmazonS3` and `AWSDataTransfer` offer files, publication
 * date 2026-11-20), not from memory. Prices change; when you update them, bump
 * PRICING_LAST_CHECKED and re-check against PRICING_URL.
 *
 * Pure functions and plain data only -- this module is imported by the client-side
 * estimator, so it must not read process.env or touch Node APIs.
 */

export const PRICING_LAST_CHECKED = "2026-11-22";
export const PRICING_URL = "https://aws.amazon.com/s3/pricing/";

/** AWS bills "GB" as 2^30 bytes. */
const BILLING_GB = 1024 ** 3;

export type Tier = "bulk" | "standard";

export const TIERS: Record<Tier, { label: string; wait: string }> = {
  bulk: { label: "Bulk", wait: "~48 hours" },
  standard: { label: "Standard", wait: "~12 hours" },
};

export type RegionPricing = {
  region: string;
  /** Deep Archive storage, USD per GB-month. */
  storagePerGbMonth: number;
  /** Deep Archive retrieval fee, USD per GB restored. */
  retrievalPerGb: Record<Tier, number>;
  /** Restore requests, USD per 1,000 -- one request per file. */
  requestsPer1000: Record<Tier, number>;
  /**
   * Data transfer out to the internet, USD per GB, first paid tier (up to 10 TB/month).
   * The first 100 GB/month across the whole account is free; that is deliberately not
   * subtracted here, because the app cannot see what else you have transferred this month.
   */
  egressPerGb: number;
  /** S3 Standard storage, USD per GB-month: what a restored copy is billed at while it exists. */
  standardStoragePerGbMonth: number;
};

const r = (
  region: string,
  storage: number,
  retrieval: [bulk: number, standard: number],
  requests: [bulk: number, standard: number],
  egress: number,
  standardStorage: number,
): RegionPricing => ({
  region,
  storagePerGbMonth: storage,
  retrievalPerGb: { bulk: retrieval[0], standard: retrieval[1] },
  requestsPer1000: { bulk: requests[0], standard: requests[1] },
  egressPerGb: egress,
  standardStoragePerGbMonth: standardStorage,
});

// prettier-ignore
const REGIONS: Record<string, RegionPricing> = {
  //                      storage   retrieval          requests /1000     egress  S3 Std
  "us-east-1":      r("us-east-1",      0.00099, [0.0025, 0.02 ],  [0.025,  0.10  ], 0.09,  0.023),
  "us-east-2":      r("us-east-2",      0.00099, [0.0025, 0.02 ],  [0.025,  0.10  ], 0.09,  0.023),
  "us-west-2":      r("us-west-2",      0.00099, [0.0025, 0.02 ],  [0.025,  0.10  ], 0.09,  0.023),
  "ca-central-1":   r("ca-central-1",   0.0018,  [0.005,  0.022],  [0.0275, 0.11  ], 0.09,  0.025),
  "eu-west-1":      r("eu-west-1",      0.00099, [0.003,  0.02 ],  [0.025,  0.11  ], 0.09,  0.023),
  "eu-west-2":      r("eu-west-2",      0.0018,  [0.005,  0.021],  [0.026,  0.106 ], 0.09,  0.024),
  "eu-central-1":   r("eu-central-1",   0.0018,  [0.005,  0.024],  [0.03,   0.12  ], 0.09,  0.0245),
  "ap-southeast-1": r("ap-southeast-1", 0.002,   [0.005,  0.024],  [0.03,   0.12  ], 0.12,  0.025),
  "ap-southeast-2": r("ap-southeast-2", 0.002,   [0.005,  0.024],  [0.03,   0.12  ], 0.114, 0.025),
  "ap-northeast-1": r("ap-northeast-1", 0.002,   [0.005,  0.022],  [0.025,  0.1142], 0.114, 0.025),
};

const FALLBACK_REGION = "us-east-1";

/**
 * Pricing for a region. Unknown regions fall back to us-east-1 -- usually the cheapest,
 * so an estimate built on the fallback will tend to understate -- and say so, so the UI
 * can warn rather than quietly show the wrong numbers.
 */
export function pricingFor(region: string | undefined): {
  pricing: RegionPricing;
  requested: string;
  isFallback: boolean;
} {
  const requested = region?.trim() || "(unset)";
  const known = region ? REGIONS[region.trim()] : undefined;
  return known
    ? { pricing: known, requested, isFallback: false }
    : { pricing: REGIONS[FALLBACK_REGION], requested, isFallback: true };
}

export type ThawEstimate = {
  retrieval: number;
  requests: number;
  transfer: number;
  total: number;
};

/** Cost to restore `fileCount` files totalling `bytes`, then download them. */
export function estimateThaw(
  selection: { fileCount: number; bytes: number },
  pricing: RegionPricing,
  tier: Tier,
): ThawEstimate {
  const gb = selection.bytes / BILLING_GB;
  const retrieval = gb * pricing.retrievalPerGb[tier];
  const requests = (selection.fileCount / 1000) * pricing.requestsPer1000[tier];
  const transfer = gb * pricing.egressPerGb;
  return { retrieval, requests, transfer, total: retrieval + requests + transfer };
}

/** Holding a restored copy, per day, at the S3 Standard rate. */
export function restoredCopyPerDay(bytes: number, pricing: RegionPricing): number {
  return ((bytes / BILLING_GB) * pricing.standardStoragePerGbMonth) / 30;
}

/** Ongoing Deep Archive storage bill for `bytes`, per month. */
export function monthlyStorageCost(bytes: number, pricing: RegionPricing): number {
  return (bytes / BILLING_GB) * pricing.storagePerGbMonth;
}
