#!/usr/bin/env node
/**
 * Regenerates frontend/src/data/transparency.json (the /transparency page's
 * hosting-cost table) from the Cloud Billing BigQuery export.
 *
 * Usage:
 *   GCP_PROJECT_ID=observ-ing node scripts/update-transparency.mjs
 *
 * Needs `bq` on PATH, authenticated as a principal with bigquery.jobs.create
 * on the project and read access to the billing export dataset. Prints a
 * Markdown summary to stdout, which .github/workflows/transparency.yml uses as
 * the PR body.
 *
 * Only closed invoice months are written (the current month is still
 * accruing). Every run rewrites the full history, so late billing adjustments
 * to earlier months are picked up too. Figures are gross: `cost` before Free
 * Tier and promotional credits.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const OUTPUT = new URL("../frontend/src/data/transparency.json", import.meta.url).pathname;

// Plain-language line items for the page, in display order; the first
// matching rule wins. The standard billing export doesn't say which Cloud Run
// service a cost belongs to, so Cloud Run is split by billing mode, which
// currently identifies the service: tap-ingester is the only one with
// always-allocated CPU (--no-cpu-throttling, "Instance-based billing" SKUs)
// and species-id the only request-billed one kept warm (--min-instances=1,
// "Min Instance" SKUs). Revisit this if either deploy flag changes in ci.yml.
const CATEGORIES = [
  {
    name: "Ingestion",
    description:
      "tap-ingester, which runs around the clock to index new observations from the AT Protocol network.",
    match: (service, sku) => service === "Cloud Run" && sku.includes("(Instance-based billing)"),
  },
  {
    name: "Species ID",
    description:
      "Keeping the species identification model loaded so suggestions come back quickly. Before June 2026 the ingester was billed the same way and is counted here.",
    match: (service, sku) => service === "Cloud Run" && sku.includes("Min Instance"),
  },
  {
    name: "Database",
    description:
      "The PostgreSQL database (Cloud SQL) that stores observations and identifications.",
    match: (service) => service === "Cloud SQL",
  },
  {
    name: "Website & API",
    description:
      "The observ.ing website and API, plus smaller on-demand services such as the live camera model, Storybook and database migrations.",
    match: (service) => service === "Cloud Run",
  },
  {
    name: "Images & CI",
    description:
      "Storing the app's container images (Artifact Registry) and downloading them during builds.",
    match: (service) => service === "Artifact Registry",
  },
  {
    name: "Tax",
    description: "Sales tax on the monthly bill.",
    match: (service, sku) => service === "Invoice" && sku === "Tax",
  },
  {
    name: "Other",
    description: "Everything else, such as DNS.",
    match: () => true,
  },
];

const project = process.env.GCP_PROJECT_ID;
if (!project) {
  console.error("update-transparency: GCP_PROJECT_ID is not set");
  process.exit(1);
}

// The export table is named after the billing account
// (gcp_billing_export_v1_<ACCOUNT_ID>); a wildcard matches it without
// committing the account ID to this public repo.
const sql = `
  SELECT
    invoice.month AS invoice_month,
    service.description AS service_name,
    sku.description AS sku_name,
    SUM(cost) AS gross_cost
  FROM \`${project}.observ_ing_billing_export.gcp_billing_export_v1_*\`
  WHERE invoice.month < FORMAT_DATE('%Y%m', CURRENT_DATE('America/Los_Angeles'))
  GROUP BY invoice_month, service_name, sku_name
  ORDER BY invoice_month DESC
`;

const rows = JSON.parse(
  execFileSync(
    "bq",
    [
      "--quiet",
      "--format=json",
      `--project_id=${project}`,
      "query",
      "--use_legacy_sql=false",
      "--max_rows=100000",
      sql,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ),
);

// An empty result means a misconfigured query or missing permissions, not a
// free month; refuse rather than blank the page.
if (rows.length === 0) {
  console.error("update-transparency: billing export query returned no rows");
  process.exit(1);
}

// month -> category name -> unrounded total. Rounding happens per category so
// sub-cent SKUs still add up.
const totals = new Map();
for (const row of rows) {
  const { invoice_month: raw, service_name: service, sku_name: sku } = row;
  const cost = Number(row.gross_cost);
  if (!/^\d{6}$/.test(raw) || !service || !sku || !Number.isFinite(cost)) {
    console.error(`update-transparency: unexpected row ${JSON.stringify(row)}`);
    process.exit(1);
  }
  const month = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  const category = CATEGORIES.find((c) => c.match(service, sku)).name;
  if (!totals.has(month)) totals.set(month, new Map());
  const byCategory = totals.get(month);
  byCategory.set(category, (byCategory.get(category) ?? 0) + cost);
}

const months = [...totals].map(([month, byCategory]) => ({
  month,
  items: CATEGORIES.map((c) => ({
    name: c.name,
    cost: Math.round((byCategory.get(c.name) ?? 0) * 100) / 100,
  })).filter((item) => item.cost !== 0),
}));
const used = new Set(months.flatMap((m) => m.items.map((item) => item.name)));
const categories = CATEGORIES.filter((c) => used.has(c.name));

const existing = JSON.parse(readFileSync(OUTPUT, "utf8"));

// Hand-serialized so each month's line items stay on one line apiece,
// matching the committed file and keeping monthly diffs readable.
const categoryBlocks = categories.map((c) =>
  [
    "    {",
    `      "name": ${JSON.stringify(c.name)},`,
    `      "description": ${JSON.stringify(c.description)}`,
    "    }",
  ].join("\n"),
);
const monthBlocks = months.map(({ month, items }) =>
  [
    "    {",
    `      "month": "${month}",`,
    '      "items": [',
    items
      .map((item) => `        { "name": ${JSON.stringify(item.name)}, "cost": ${item.cost} }`)
      .join(",\n"),
    "      ]",
    "    }",
  ].join("\n"),
);
writeFileSync(
  OUTPUT,
  [
    "{",
    `  "currency": ${JSON.stringify(existing.currency)},`,
    `  "notes": ${JSON.stringify(existing.notes)},`,
    '  "categories": [',
    categoryBlocks.join(",\n"),
    "  ],",
    '  "months": [',
    monthBlocks.join(",\n"),
    "  ]",
    "}",
    "",
  ].join("\n"),
);

const formatCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: existing.currency,
}).format;
const costOf = (items, name) => items.find((item) => item.name === name)?.cost ?? 0;
console.log("Monthly gross hosting costs from the Cloud Billing BigQuery export.\n");
console.log(`| Month | ${categories.map((c) => c.name).join(" | ")} | Total |`);
console.log(`| --- |${" ---: |".repeat(categories.length + 1)}`);
for (const { month, items } of months) {
  const cells = categories.map((c) => formatCurrency(costOf(items, c.name)));
  const total = items.reduce((sum, item) => sum + item.cost, 0);
  console.log(`| ${month} | ${cells.join(" | ")} | ${formatCurrency(total)} |`);
}
console.log("\nGenerated by `.github/workflows/transparency.yml`.");
