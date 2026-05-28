/**
 * Builds OEC-based trade game data and a dedicated allowlist.
 * Run: node scripts/generate-oec-trade-game-data.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_ROOT = "https://api-v2.oec.world/tesseract";
const CUBE = "trade_i_baci_a_22";
const YEAR = 2023;
const TOKEN = "6b540954e368f971";

const OUT_DATA = path.join(__dirname, "..", "src", "data", "oec-trade-game-data.json");
const OUT_ALLOWLIST = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "country-allowlist-oec.json",
);

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "GeoGames/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

function tradeItemFromRow(row) {
  return {
    code: String(row["HS2 ID"] ?? "").padStart(2, "0"),
    product: String(row.HS2 ?? "").trim(),
    value: Number(row["Trade Value"] ?? 0),
  };
}

function toShares(items) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total) {
    return [];
  }
  return items
    .filter((item) => item.value > 0 && item.product)
    .sort((a, b) => b.value - a.value)
    .map((item) => ({
      ...item,
      share: item.value / total,
    }));
}

async function main() {
  const exportsUrl =
    `${API_ROOT}/data.jsonrecords?cube=${CUBE}` +
    `&drilldowns=Exporter+Country,HS2,Year` +
    `&measures=Trade+Value` +
    `&include=Year:${YEAR}` +
    `&parents=false&limit=50000,0` +
    `&token=${TOKEN}`;
  const importsUrl =
    `${API_ROOT}/data.jsonrecords?cube=${CUBE}` +
    `&drilldowns=Importer+Country,HS2,Year` +
    `&measures=Trade+Value` +
    `&include=Year:${YEAR}` +
    `&parents=false&limit=50000,0` +
    `&token=${TOKEN}`;

  const [exportsData, importsData] = await Promise.all([
    fetchJson(exportsUrl),
    fetchJson(importsUrl),
  ]);

  const countries = new Map();

  for (const row of exportsData.data ?? []) {
    const oecId = String(row["Exporter Country ID"] ?? "").trim();
    const countryName = String(row["Exporter Country"] ?? "").trim();
    if (!oecId || !countryName) {
      continue;
    }
    const entry = countries.get(oecId) ?? {
      oecId,
      iso3: oecId.slice(-3).toUpperCase(),
      name: countryName,
      year: YEAR,
      exports: [],
      imports: [],
    };
    entry.exports.push(tradeItemFromRow(row));
    countries.set(oecId, entry);
  }

  for (const row of importsData.data ?? []) {
    const oecId = String(row["Importer Country ID"] ?? "").trim();
    const countryName = String(row["Importer Country"] ?? "").trim();
    if (!oecId || !countryName) {
      continue;
    }
    const entry = countries.get(oecId) ?? {
      oecId,
      iso3: oecId.slice(-3).toUpperCase(),
      name: countryName,
      year: YEAR,
      exports: [],
      imports: [],
    };
    entry.imports.push(tradeItemFromRow(row));
    countries.set(oecId, entry);
  }

  const rows = [...countries.values()]
    .map((country) => ({
      ...country,
      exports: toShares(country.exports),
      imports: toShares(country.imports),
    }))
    .filter(
      (country) =>
        /^[a-z]{5}$/i.test(country.oecId) &&
        country.exports.length > 0 &&
        country.imports.length > 0,
    )
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  const byOecId = new Map(rows.map((country) => [country.oecId, country]));

  let allowlist;
  if (fs.existsSync(OUT_ALLOWLIST)) {
    const existing = JSON.parse(fs.readFileSync(OUT_ALLOWLIST, "utf8"));
    allowlist = existing
      .map((entry) => {
        const fresh = byOecId.get(entry.oecId);
        if (!fresh) {
          return null;
        }
        return {
          oecId: fresh.oecId,
          iso3: fresh.iso3,
          name: fresh.name,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
    const dropped = existing.length - allowlist.length;
    if (dropped > 0) {
      console.log(
        `Allowlist: kept ${allowlist.length} entries (${dropped} removed — no longer in OEC data)`,
      );
    }
  } else {
    allowlist = rows.map((country) => ({
      oecId: country.oecId,
      iso3: country.iso3,
      name: country.name,
    }));
  }

  fs.mkdirSync(path.dirname(OUT_DATA), { recursive: true });
  fs.writeFileSync(OUT_DATA, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUT_ALLOWLIST, `${JSON.stringify(allowlist, null, 2)}\n`, "utf8");

  console.log(`Wrote ${rows.length} countries to ${path.relative(process.cwd(), OUT_DATA)}`);
  console.log(`Wrote ${allowlist.length} entries to ${path.relative(process.cwd(), OUT_ALLOWLIST)}`);
  console.log(
    `Game pool: ${allowlist.length} allowlisted of ${rows.length} with full export+import data`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
