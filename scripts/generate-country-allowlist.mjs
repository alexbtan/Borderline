/**
 * Regenerates src/data/country-allowlist.json from Natural Earth admin-0 countries.
 * Run: npm run generate:allowlist
 *
 * After regenerating, re-apply any removals you want (delete whole { "code", "name" } objects).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATASET_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson";

const OUT = path.join(__dirname, "..", "src", "data", "country-allowlist.json");

async function main() {
  const response = await fetch(DATASET_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch dataset: ${response.status}`);
  }
  const data = await response.json();
  const rows = data.features
    .map((feature) => {
      const code = String(feature.properties?.ADM0_A3 ?? "").trim();
      const name = String(
        feature.properties?.ADMIN ?? feature.properties?.NAME ?? "",
      ).trim();
      return code && name ? { code, name } : null;
    })
    .filter(Boolean);

  rows.sort((a, b) => a.name.localeCompare(b.name, "en"));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(`${OUT}`, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  console.log(`Wrote ${rows.length} entries to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
