"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import countryAllowlist from "@/data/country-allowlist.json";
import {
  type CountryFeature,
  type FeatureCollection,
  DATASET_URL,
  buildCountryMapPath,
  getCountryCode,
  getCountryName,
} from "@/lib/country-geo";

type CountryAllowlistEntry = { code: string; name: string };

const ALLOWLIST_CODES = new Set(
  (countryAllowlist as CountryAllowlistEntry[]).map((entry) => entry.code),
);

const PREVIEW_INNER = 96;
const PREVIEW_PAD = 10;
const PREVIEW_VIEW = PREVIEW_INNER + PREVIEW_PAD * 2;
const PREVIEW_MIN_EDGE = 72;
const PREVIEW_MAX_ZOOM = 5;

type Tile = {
  code: string;
  name: string;
  path: string;
};

export default function GalleryPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countries, setCountries] = useState<CountryFeature[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(DATASET_URL);
        if (!response.ok) {
          throw new Error("Failed to fetch country shapes.");
        }
        const data = (await response.json()) as FeatureCollection;
        const features = data.features.filter(
          (feature) =>
            getCountryName(feature) && ALLOWLIST_CODES.has(getCountryCode(feature)),
        );
        if (!features.length) {
          throw new Error("Allowlist produced no countries.");
        }
        features.sort((a, b) =>
          getCountryName(a).localeCompare(getCountryName(b), "en"),
        );
        if (!cancelled) {
          setCountries(features);
        }
      } catch {
        if (!cancelled) {
          setError("Could not load country data. Please refresh and try again.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const tiles: Tile[] = useMemo(
    () =>
      countries.map((country) => {
        const { path } = buildCountryMapPath(country, {
          innerSize: PREVIEW_INNER,
          minCountryMinEdgePx: PREVIEW_MIN_EDGE,
          maxSmallCountryZoom: PREVIEW_MAX_ZOOM,
        });
        return {
          code: getCountryCode(country),
          name: getCountryName(country),
          path,
        };
      }),
    [countries],
  );

  return (
    <main className="mx-auto min-h-dvh w-full max-w-6xl px-4 py-6 text-slate-100 sm:px-6">
      <header className="mb-6 flex flex-col gap-3 border-b border-slate-700 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-sky-300/60 uppercase">
            Testing
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Country outline gallery
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            Every entry uses the same rules as the game. To drop one from the pool, remove its{" "}
            <code className="rounded bg-slate-800 px-1 py-0.5 text-xs text-sky-200/80">code</code> object from{" "}
            <code className="rounded bg-slate-800 px-1 py-0.5 text-xs text-sky-200/80">src/data/country-allowlist.json</code>
            .
          </p>
        </div>
        <Link
          href="/"
          className="shrink-0 rounded-xl bg-sky-700 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-sky-600"
        >
          Back to game
        </Link>
      </header>

      {loading && (
        <p className="text-center text-slate-400">Loading outlines…</p>
      )}

      {error && (
        <p className="rounded-xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-center text-red-200">
          {error}
        </p>
      )}

      {!loading && !error && (
        <p className="mb-4 text-sm text-slate-400">
          Showing <span className="font-medium text-white">{tiles.length}</span> countries
          (allowlist ∩ dataset).
        </p>
      )}

      {!loading && !error && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {tiles.map((tile) => (
            <li
              key={tile.code}
              className="flex flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-sm shadow-black/20"
            >
              <div className="border-b border-slate-800 bg-slate-950 p-2">
                <svg
                  viewBox={`0 0 ${PREVIEW_VIEW} ${PREVIEW_VIEW}`}
                  className="aspect-square w-full"
                  aria-hidden
                >
                  <g transform={`translate(${PREVIEW_PAD}, ${PREVIEW_PAD})`}>
                    <path
                      d={tile.path}
                      fill="#2f5f86"
                      stroke="#8fb6d6"
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                </svg>
              </div>
              <div className="flex flex-1 flex-col gap-0.5 p-2.5">
                <p className="text-xs font-semibold tracking-wide text-sky-300/60 uppercase">
                  {tile.code}
                </p>
                <p className="line-clamp-2 text-sm font-medium text-slate-100">{tile.name}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
