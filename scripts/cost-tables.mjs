// Prints the README's "The real cost" tables, computed from src/lib/pricing.ts.
//
//   npm run cost-tables
//
// Paste the output into the README when prices or exchange rates change. Exchange rates
// are fixed here on purpose (one per currency, with its date) so the tables are
// reproducible; update RATES_DATE and RATES together.

const { pricingFor, estimateThaw, uploadCost, monthlyHoldCost } = await import(
  "../src/lib/pricing.ts"
);

const REGIONS = [
  ["us-east-1", "US East `us-east-1`"],
  ["ap-south-1", "Mumbai `ap-south-1`"],
];
// European Central Bank reference rates, converted to USD base.
const RATES_DATE = "2026-11-20";
const CURRENCIES = [
  { code: "USD", symbol: "$", rate: 1 },
  { code: "INR", symbol: "₹", rate: 92.68 },
  { code: "AUD", symbol: "A$", rate: 1.5002 },
  { code: "GBP", symbol: "£", rate: 0.76192 },
];
const GB = 1024 ** 3;
const AVG_FILE = 5 * 1024 ** 2;
const SIZES = [
  ["1 GB", 1],
  ["10 GB", 10],
  ["100 GB", 100],
  ["1 TB", 1024],
];

const money = (usd, c) => {
  const v = usd * c.rate;
  if (v > 0 && v < 0.01) return `<${c.symbol}0.01`;
  return `${c.symbol}${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const regions = REGIONS.map(([region, label]) => {
  const { pricing, isFallback } = pricingFor(region);
  if (isFallback) throw new Error(`No pricing for ${region}`);
  return { label, pricing };
});

// One table per currency; each size gets a row per region, so the regions sit side by side.
function table(c) {
  console.log("| Stored | Region | Save (once) | Hold / month | Hold / year | Thaw Bulk (~48 h) | Thaw Standard (~12 h) |");
  console.log("|---|---|--:|--:|--:|--:|--:|");
  for (const [name, gib] of SIZES) {
    const bytes = gib * GB;
    const files = Math.round(bytes / AVG_FILE);
    regions.forEach(({ label, pricing }, i) => {
      const hold = monthlyHoldCost(bytes, files, pricing);
      const thaw = (tier) => estimateThaw({ fileCount: files, bytes }, pricing, tier).total;
      const stored = i === 0 ? `**${name}** · ${files.toLocaleString("en-US")} files` : "";
      console.log(
        `| ${stored} | ${label} | ${money(uploadCost(files, AVG_FILE, pricing), c)} | ${money(hold, c)} | ${money(hold * 12, c)} | ${money(thaw("bulk"), c)} | ${money(thaw("standard"), c)} |`,
      );
    });
  }
  console.log("");
}

// USD in full; the other currencies folded into one toggle so the README stays readable.
table(CURRENCIES[0]);
const others = CURRENCIES.slice(1);
console.log(`<details><summary>Show in ${others.map((c) => c.code).join(", ")}</summary>\n`);
for (const c of others) {
  console.log(`**${c.code}**\n`);
  table(c);
}
console.log("</details>\n");
console.log(
  `<sub>Exchange rates: 1 USD = ${CURRENCIES.slice(1)
    .map((c) => `${c.rate} ${c.code}`)
    .join(", ")} (European Central Bank reference rates, ${RATES_DATE}). Approximate; your card or bank will use its own rate.</sub>`,
);
