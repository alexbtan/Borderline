/**
 * Builds capital coordinates for all OEC trade-game countries.
 * Run: node scripts/generate-capital-coordinates.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRADE_DATA_PATH = path.join(__dirname, "..", "src", "data", "oec-trade-game-data.json");
const OUT_PATH = path.join(__dirname, "..", "src", "data", "country-capitals-oec.json");

async function fetchAllCountries() {
  const response = await fetch(
    "https://restcountries.com/v3.1/all?fields=cca3,name,capital,capitalInfo",
    {
      headers: { "User-Agent": "GeoGames/1.0" },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch restcountries: ${response.status}`);
  }
  return response.json();
}

async function main() {
  const tradeCountries = JSON.parse(fs.readFileSync(TRADE_DATA_PATH, "utf8"));
  const restCountries = await fetchAllCountries();
  const byIso3 = new Map(
    restCountries.map((row) => [String(row.cca3 || "").toUpperCase(), row]),
  );

  const output = tradeCountries.map((country) => {
    const iso3 = String(country.iso3 || "").toUpperCase();
    const source = byIso3.get(iso3);
    const coords = source?.capitalInfo?.latlng;
    const lat = Array.isArray(coords) && coords.length >= 2 ? Number(coords[0]) : null;
    const lon = Array.isArray(coords) && coords.length >= 2 ? Number(coords[1]) : null;
    const capitalName = Array.isArray(source?.capital) ? String(source.capital[0] || "") : "";
    return {
      iso3,
      country: country.name,
      capital: capitalName || null,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
    };
  });

  fs.writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  const withCoords = output.filter((row) => row.lat !== null && row.lon !== null).length;
  console.log(
    `Wrote ${output.length} capital rows to ${path.relative(process.cwd(), OUT_PATH)} (${withCoords} with coordinates)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
