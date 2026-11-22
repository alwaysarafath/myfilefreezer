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
  ["us-east-1", "US East (N. Virginia)"],
  ["ap-south-1", "Asia Pacific (Mumbai)"],
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

function table(pricing, c) {
  console.log("| Stored | Files | Save (once) | Hold / month | Hold / year | Thaw Bulk (~48 h) | Thaw Standard (~12 h) |");
  console.log("|---|--:|--:|--:|--:|--:|--:|");
  for (const [name, gib] of SIZES) {
    const bytes = gib * GB;
    const files = Math.round(bytes / AVG_FILE);
    const hold = monthlyHoldCost(bytes, files, pricing);
    const thaw = (tier) => estimateThaw({ fileCount: files, bytes }, pricing, tier).total;
    console.log(
      `| ${name} | ${files.toLocaleString("en-US")} | ${money(uploadCost(files, AVG_FILE, pricing), c)} | ${money(hold, c)} | ${money(hold * 12, c)} | ${money(thaw("bulk"), c)} | ${money(thaw("standard"), c)} |`,
    );
  }
  console.log("");
}

// USD in full; the other currencies folded away so the README stays readable.
for (const [region, label] of REGIONS) {
  const { pricing, isFallback } = pricingFor(region);
  if (isFallback) throw new Error(`No pricing for ${region}`);
  console.log(`#### ${label} — \`${region}\`\n`);
  table(pricing, CURRENCIES[0]);
  const others = CURRENCIES.slice(1);
  console.log(`<details><summary>Show in ${others.map((c) => c.code).join(", ")}</summary>\n`);
  for (const c of others) {
    console.log(`**${c.code}**\n`);
    table(pricing, c);
  }
  console.log("</details>\n");
}
console.log(
  `<sub>Exchange rates: 1 USD = ${CURRENCIES.slice(1)
    .map((c) => `${c.rate} ${c.code}`)
    .join(", ")} (European Central Bank reference rates, ${RATES_DATE}). Approximate; your card or bank will use its own rate.</sub>`,
);
