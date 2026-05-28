/**
 * Builds country metadata used by the Geo Logic Grid puzzle game.
 * Pulls sovereign UN-member states from REST Countries and derives the
 * attributes the puzzle clues reason about (continent, population, capital,
 * land-border count, name word count, coordinates).
 *
 * Run: node scripts/generate-logic-grid-data.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "src", "data", "logic-grid-countries.json");

/** Minimum population so the puzzle pool stays to broadly recognisable nations. */
const MIN_POPULATION = 500_000;

async function fetchAllCountries() {
  const response = await fetch(
    "https://restcountries.com/v3.1/all?fields=cca3,name,capital,region,subregion,population,borders,latlng,area,capitalInfo",
    {
      headers: { "User-Agent": "GeoGames/1.0" },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch restcountries: ${response.status}`);
  }
  return response.json();
}

/** Maps REST Countries region/subregion onto the six puzzle continents. */
function toContinent(region, subregion) {
  switch (region) {
    case "Asia":
      return "Asia";
    case "Africa":
      return "Africa";
    case "Europe":
      return "Europe";
    case "Oceania":
      return "Oceania";
    case "Americas":
      return subregion === "South America" ? "South America" : "North America";
    default:
      return null;
  }
}

function countWords(name) {
  return name.trim().split(/\s+/).filter(Boolean).length;
}

async function main() {
  const rows = await fetchAllCountries();

  const countries = [];
  for (const row of rows) {
    const name = row?.name?.common;
    const iso3 = String(row?.cca3 || "").toUpperCase();
    if (!name || iso3.length !== 3) {
      continue;
    }
    const continent = toContinent(row.region, row.subregion);
    if (!continent) {
      continue;
    }
    const population = Number(row.population) || 0;
    if (population < MIN_POPULATION) {
      continue;
    }
    const latlng = Array.isArray(row.latlng) ? row.latlng : [];
    const lat = latlng.length >= 2 ? Number(latlng[0]) : null;
    const lon = latlng.length >= 2 ? Number(latlng[1]) : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    const capital = Array.isArray(row.capital) ? String(row.capital[0] || "") : "";
    const capCoords = row.capitalInfo?.latlng;
    const capLat =
      Array.isArray(capCoords) && capCoords.length >= 2 ? Number(capCoords[0]) : lat;
    const capLon =
      Array.isArray(capCoords) && capCoords.length >= 2 ? Number(capCoords[1]) : lon;
    const borders = Array.isArray(row.borders)
      ? row.borders.map((b) => String(b).toUpperCase())
      : [];

    countries.push({
      iso3,
      name,
      continent,
      population,
      capital: capital || null,
      area: Number(row.area) || 0,
      subregion: row.subregion || null,
      borders,
      borderCount: borders.length,
      nameWords: countWords(name),
      nameLetters: name.replace(/[^A-Za-z]/g, "").length,
      firstLetter: name[0].toUpperCase(),
      lat: Math.round(lat * 100) / 100,
      lon: Math.round(lon * 100) / 100,
      capitalLat: Math.round(capLat * 100) / 100,
      capitalLon: Math.round(capLon * 100) / 100,
    });
  }

  countries.sort((a, b) => a.name.localeCompare(b.name));

  fs.writeFileSync(OUT_PATH, `${JSON.stringify(countries, null, 2)}\n`, "utf8");

  const byContinent = countries.reduce((acc, c) => {
    acc[c.continent] = (acc[c.continent] || 0) + 1;
    return acc;
  }, {});
  console.log(
    `Wrote ${countries.length} countries to ${path.relative(process.cwd(), OUT_PATH)}`,
  );
  console.log("Per continent:", byContinent);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
