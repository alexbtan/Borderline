"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { geoArea, geoMercator, geoPath } from "d3-geo";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";

type FeatureCollection = {
  type: "FeatureCollection";
  features: CountryFeature[];
};

type CountryFeature = {
  type: "Feature";
  id?: string;
  properties?: {
    name?: string;
    NAME?: string;
    ADMIN?: string;
  };
  geometry: GeoJSON.Geometry;
};

type GameMode = "daily" | "unlimited";

type DailyStats = {
  streak: number;
  bestStreak: number;
  wins: number;
  losses: number;
  lastCompletedDate: string | null;
};

type DailyProgress = {
  date: string;
  targetName: string;
  targetId: string;
  revealDirection: RevealDirection;
  guesses: string[];
  completed: boolean;
  won: boolean;
};

type RevealDirection = "left" | "right" | "top" | "bottom";

const DATASET_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson";
const MAX_GUESSES = 6;
const STORAGE_STATS_KEY = "country-outline-daily-stats-v1";
const STORAGE_PROGRESS_KEY = "country-outline-daily-progress-v1";
const SVG_SIZE = 440;
const SVG_PADDING = 22;
const MIN_SHAPE_VISIBLE_RATIO = 0.09;
const REVEAL_DIRECTIONS: RevealDirection[] = ["left", "right", "top", "bottom"];

const defaultStats: DailyStats = {
  streak: 0,
  bestStreak: 0,
  wins: 0,
  losses: 0,
  lastCompletedDate: null,
};

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function hashDateToIndex(dateString: string, length: number) {
  const hash = [...dateString].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return hash % length;
}

function hashStringToIndex(value: string, length: number) {
  const hash = [...value].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 0);
  return hash % length;
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function getCountryName(country: CountryFeature) {
  return country.properties?.name ?? country.properties?.ADMIN ?? country.properties?.NAME ?? "";
}

function featureArea(geometry: GeoJSON.Geometry) {
  return geoArea({
    type: "Feature",
    geometry,
    properties: {},
  } as GeoJSON.Feature);
}

function getDisplayGeometry(country: CountryFeature): GeoJSON.Geometry {
  const { geometry } = country;

  if (geometry.type !== "MultiPolygon") {
    return geometry;
  }

  const polygons = geometry.coordinates.map((polygon) => ({
    polygon,
    area: featureArea({
      type: "Polygon",
      coordinates: polygon,
    }),
  }));

  if (!polygons.length) {
    return geometry;
  }

  const largestArea = Math.max(...polygons.map((item) => item.area));
  const keptPolygons = polygons
    .filter((item) => item.area >= largestArea * 0.04)
    .map((item) => item.polygon);

  if (!keptPolygons.length) {
    const largestPolygon = polygons.find((item) => item.area === largestArea);
    return {
      type: "Polygon",
      coordinates: largestPolygon?.polygon ?? geometry.coordinates[0],
    };
  }

  if (keptPolygons.length === 1) {
    return {
      type: "Polygon",
      coordinates: keptPolygons[0],
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: keptPolygons,
  };
}

function getDailyRevealDirection(seed: string) {
  return REVEAL_DIRECTIONS[hashStringToIndex(seed, REVEAL_DIRECTIONS.length)];
}

function getRandomRevealDirection() {
  return REVEAL_DIRECTIONS[Math.floor(Math.random() * REVEAL_DIRECTIONS.length)];
}

/**
 * Estimates visible shape fraction for the mask, which uses maskContentUnits
 * objectBoundingBox (reveal strip is a fraction of the path's own bbox — not
 * the full SVG viewBox). Sampling uses the same bbox-anchored strip as the mask.
 */
function getVisibleShapeRatio(
  pathData: string,
  bounds: [[number, number], [number, number]],
  revealDirection: RevealDirection,
  revealPercent: number,
) {
  if (typeof window === "undefined" || !pathData) {
    return revealPercent;
  }
  if (typeof Path2D === "undefined") {
    return revealPercent;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) {
    return revealPercent;
  }

  const shape = new Path2D(pathData);
  const [[x0, y0], [x1, y1]] = bounds;
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const cols = 70;
  const rows = 70;

  const revealX0 = revealDirection === "right" ? x1 - width * revealPercent : x0;
  const revealX1 = revealDirection === "left" ? x0 + width * revealPercent : x1;
  const revealY0 = revealDirection === "bottom" ? y1 - height * revealPercent : y0;
  const revealY1 = revealDirection === "top" ? y0 + height * revealPercent : y1;

  let shapeSamples = 0;
  let visibleSamples = 0;

  for (let row = 0; row < rows; row += 1) {
    const y = y0 + ((row + 0.5) / rows) * height;
    for (let col = 0; col < cols; col += 1) {
      const x = x0 + ((col + 0.5) / cols) * width;
      if (!context.isPointInPath(shape, x, y)) {
        continue;
      }
      shapeSamples += 1;
      if (x >= revealX0 && x <= revealX1 && y >= revealY0 && y <= revealY1) {
        visibleSamples += 1;
      }
    }
  }

  if (!shapeSamples) {
    return 0;
  }
  return visibleSamples / shapeSamples;
}

function loadFromStorage<T>(key: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function saveToStorage(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

export default function Home() {
  const [mode, setMode] = useState<GameMode>("daily");
  const [allCountries, setAllCountries] = useState<CountryFeature[]>([]);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [targetCountry, setTargetCountry] = useState<CountryFeature | null>(null);
  const [guesses, setGuesses] = useState<string[]>([]);
  const [guessValue, setGuessValue] = useState("");
  const [dailyStats, setDailyStats] = useState<DailyStats>(defaultStats);
  const [dailyProgress, setDailyProgress] = useState<DailyProgress | null>(null);
  const [revealDirection, setRevealDirection] = useState<RevealDirection>("left");
  const [unlimitedAnswerRevealed, setUnlimitedAnswerRevealed] = useState(false);

  useEffect(() => {
    async function loadCountries() {
      try {
        setLoading(true);
        const response = await fetch(DATASET_URL);
        if (!response.ok) {
          throw new Error("Failed to fetch country shapes.");
        }
        const data = (await response.json()) as FeatureCollection;
        const features = data.features.filter((feature) => getCountryName(feature));
        setAllCountries(features);
      } catch {
        setLoadingError("Could not load country data. Please refresh and try again.");
      } finally {
        setLoading(false);
      }
    }
    loadCountries();
  }, []);

  useEffect(() => {
    const savedStats = loadFromStorage<DailyStats>(STORAGE_STATS_KEY);
    if (savedStats) {
      setDailyStats(savedStats);
    }
  }, []);

  useEffect(() => {
    if (!allCountries.length) {
      return;
    }

    if (mode === "daily") {
      setUnlimitedAnswerRevealed(false);
      const today = getTodayKey();
      const savedProgress = loadFromStorage<DailyProgress>(STORAGE_PROGRESS_KEY);
      if (savedProgress?.date === today) {
        const resolvedRevealDirection = savedProgress.revealDirection
          ? savedProgress.revealDirection
          : getDailyRevealDirection(`${today}-${savedProgress.targetId || savedProgress.targetName}`);
        const normalizedProgress: DailyProgress = {
          ...savedProgress,
          revealDirection: resolvedRevealDirection,
        };
        setRevealDirection(resolvedRevealDirection);
        setDailyProgress(normalizedProgress);
        setGuesses(savedProgress.guesses);
        const target = allCountries.find(
          (country) =>
            (savedProgress.targetId && country.id === savedProgress.targetId) ||
            normalizeName(getCountryName(country)) === normalizeName(savedProgress.targetName),
        );
        setTargetCountry(target ?? null);
        saveToStorage(STORAGE_PROGRESS_KEY, normalizedProgress);
      } else {
        const targetIndex = hashDateToIndex(today, allCountries.length);
        const newTarget = allCountries[targetIndex];
        const direction = getDailyRevealDirection(
          `${today}-${newTarget.id ?? getCountryName(newTarget)}`,
        );
        const newProgress: DailyProgress = {
          date: today,
          targetName: getCountryName(newTarget),
          targetId: newTarget.id ?? "",
          revealDirection: direction,
          guesses: [],
          completed: false,
          won: false,
        };
        setTargetCountry(newTarget);
        setRevealDirection(direction);
        setGuesses([]);
        setDailyProgress(newProgress);
        saveToStorage(STORAGE_PROGRESS_KEY, newProgress);
      }
      return;
    }

    setUnlimitedAnswerRevealed(false);
    const randomCountry =
      allCountries[Math.floor(Math.random() * allCountries.length)];
    setTargetCountry(randomCountry);
    setRevealDirection(getRandomRevealDirection());
    setGuesses([]);
  }, [mode, allCountries]);

  const countryNames = useMemo(
    () =>
      allCountries
        .map((country) => getCountryName(country))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [allCountries],
  );

  const filteredSuggestions = useMemo(() => {
    const search = normalizeName(guessValue);
    if (!search) {
      return [];
    }
    return countryNames
      .filter((name) => normalizeName(name).includes(search))
      .slice(0, 7);
  }, [countryNames, guessValue]);

  const targetName = targetCountry ? getCountryName(targetCountry) : "";
  const won = guesses.some((guess) => normalizeName(guess) === normalizeName(targetName));
  const lost = !won && guesses.length >= MAX_GUESSES;
  const completed =
    won || lost || (mode === "unlimited" && unlimitedAnswerRevealed);
  const unlimitedRevealedEarly =
    mode === "unlimited" && unlimitedAnswerRevealed && !won && !lost;

  const renderShape = useMemo(() => {
    if (!targetCountry) {
      return { path: "", bounds: [[0, 0], [SVG_SIZE, SVG_SIZE]] as [[number, number], [number, number]] };
    }
    const displayGeometry = getDisplayGeometry(targetCountry);
    const projection = geoMercator().fitSize(
      [SVG_SIZE - SVG_PADDING * 2, SVG_SIZE - SVG_PADDING * 2],
      displayGeometry as never,
    );
    const pathBuilder = geoPath(projection);
    const path = pathBuilder(displayGeometry as never) ?? "";
    const bounds = pathBuilder.bounds(displayGeometry as never) as [[number, number], [number, number]];
    return { path, bounds };
  }, [targetCountry]);

  const minimumFirstRevealPercent = useMemo(() => {
    if (!renderShape.path) {
      return 0.18;
    }
    let low = 0.04;
    let high = 0.65;
    for (let i = 0; i < 11; i += 1) {
      const mid = (low + high) / 2;
      const visibleRatio = getVisibleShapeRatio(
        renderShape.path,
        renderShape.bounds,
        revealDirection,
        mid,
      );
      if (visibleRatio >= MIN_SHAPE_VISIBLE_RATIO) {
        high = mid;
      } else {
        low = mid;
      }
    }
    return high;
  }, [renderShape.path, renderShape.bounds, revealDirection]);

  const revealPercent = completed
    ? 1
    : Math.min(
        Math.max(0.18 + guesses.length * 0.14, minimumFirstRevealPercent),
        0.92,
      );

  function updateDailyAfterCompletion(isWin: boolean, nextGuesses: string[]) {
    if (mode !== "daily" || !dailyProgress) {
      return;
    }
    if (dailyProgress.completed) {
      return;
    }

    const today = getTodayKey();
    const previousDate = dailyStats.lastCompletedDate;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const nextStreak =
      isWin && previousDate === yesterday
        ? dailyStats.streak + 1
        : isWin
          ? 1
          : 0;
    const updatedStats: DailyStats = {
      streak: nextStreak,
      bestStreak: Math.max(dailyStats.bestStreak, nextStreak),
      wins: dailyStats.wins + (isWin ? 1 : 0),
      losses: dailyStats.losses + (isWin ? 0 : 1),
      lastCompletedDate: today,
    };
    setDailyStats(updatedStats);
    saveToStorage(STORAGE_STATS_KEY, updatedStats);

    const updatedProgress: DailyProgress = {
      ...dailyProgress,
      guesses: nextGuesses,
      completed: true,
      won: isWin,
    };
    setDailyProgress(updatedProgress);
    saveToStorage(STORAGE_PROGRESS_KEY, updatedProgress);
  }

  function handleGuessInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || completed) {
      return;
    }
    const trimmed = guessValue.trim();
    if (!trimmed) {
      return;
    }
    const exactMatch = countryNames.some(
      (countryName) => normalizeName(countryName) === normalizeName(trimmed),
    );
    if (exactMatch) {
      return;
    }
    const top = filteredSuggestions[0];
    if (!top) {
      return;
    }
    event.preventDefault();
    setGuessValue(top);
  }

  function handleGuessSubmit(event: FormEvent) {
    event.preventDefault();
    if (!targetCountry || completed) {
      return;
    }
    const normalizedInput = normalizeName(guessValue);
    if (!normalizedInput) {
      return;
    }

    const selectedCountry = countryNames.find(
      (countryName) => normalizeName(countryName) === normalizedInput,
    );
    if (!selectedCountry) {
      return;
    }
    if (guesses.some((guess) => normalizeName(guess) === normalizedInput)) {
      setGuessValue("");
      return;
    }

    const nextGuesses = [...guesses, selectedCountry];
    setGuesses(nextGuesses);
    setGuessValue("");

    const isWin = normalizeName(selectedCountry) === normalizeName(targetName);
    const isLoss = !isWin && nextGuesses.length >= MAX_GUESSES;

    if (mode === "daily") {
      const nextProgress = dailyProgress
        ? { ...dailyProgress, guesses: nextGuesses }
        : null;
      if (nextProgress) {
        setDailyProgress(nextProgress);
        saveToStorage(STORAGE_PROGRESS_KEY, nextProgress);
      }
      if (isWin || isLoss) {
        updateDailyAfterCompletion(isWin, nextGuesses);
      }
    }
  }

  function startNextUnlimitedRound() {
    if (mode !== "unlimited" || !allCountries.length) {
      return;
    }
    let nextCountry = allCountries[Math.floor(Math.random() * allCountries.length)];
    if (targetCountry && allCountries.length > 1) {
      let guard = 0;
      while (
        getCountryName(nextCountry) === getCountryName(targetCountry) &&
        guard < 24
      ) {
        nextCountry = allCountries[Math.floor(Math.random() * allCountries.length)];
        guard += 1;
      }
    }
    setTargetCountry(nextCountry);
    setRevealDirection(getRandomRevealDirection());
    setGuesses([]);
    setGuessValue("");
    setUnlimitedAnswerRevealed(false);
  }

  function revealUnlimitedAnswer() {
    if (mode !== "unlimited" || completed || !targetCountry) {
      return;
    }
    setUnlimitedAnswerRevealed(true);
    setGuessValue("");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6 sm:px-8 sm:py-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">
            Daily Geography Game
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Partial Country Outlines
          </h1>
        </div>
        <div className="inline-flex w-full rounded-xl bg-slate-200 p-1 sm:w-auto">
          {(["daily", "unlimited"] as GameMode[]).map((gameMode) => (
            <button
              type="button"
              key={gameMode}
              onClick={() => setMode(gameMode)}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition sm:flex-initial ${
                mode === gameMode
                  ? "bg-white text-slate-900 shadow"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {gameMode === "daily" ? "Daily" : "Unlimited"}
            </button>
          ))}
        </div>
      </header>

      {loading && (
        <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-600 shadow-sm">
          Loading country data...
        </section>
      )}

      {!loading && loadingError && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-red-700 shadow-sm">
          {loadingError}
        </section>
      )}

      {!loading && !loadingError && targetCountry && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mx-auto mb-5 w-full max-w-md rounded-xl border border-slate-200 bg-slate-50 p-2 sm:p-3">
            <svg viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} className="h-full w-full">
              <defs>
                <mask
                  id="reveal-mask"
                  maskUnits="objectBoundingBox"
                  maskContentUnits="objectBoundingBox"
                >
                  <rect x="0" y="0" width="1" height="1" fill="black" />
                  <rect
                    x={
                      revealDirection === "right"
                        ? 1 - revealPercent
                        : 0
                    }
                    y={
                      revealDirection === "bottom"
                        ? 1 - revealPercent
                        : 0
                    }
                    width={
                      revealDirection === "left" || revealDirection === "right"
                        ? revealPercent
                        : 1
                    }
                    height={
                      revealDirection === "top" || revealDirection === "bottom"
                        ? revealPercent
                        : 1
                    }
                    fill="white"
                  />
                </mask>
              </defs>
              <g transform={`translate(${SVG_PADDING}, ${SVG_PADDING})`}>
                <path
                  d={renderShape.path}
                  fill="#e2e8f0"
                  stroke="#94a3b8"
                  strokeWidth="1.4"
                  mask="url(#reveal-mask)"
                />
              </g>
            </svg>
          </div>

          {!completed && (
            <p className="mb-4 text-center text-sm text-slate-600">
              Guess {guesses.length + 1} of {MAX_GUESSES}
            </p>
          )}

          {completed && (
            <div className="mx-auto mb-5 w-full max-w-xl rounded-2xl border-2 border-slate-900 bg-slate-900 px-5 py-5 text-center shadow-lg sm:px-8 sm:py-6">
              <p className="text-[0.7rem] font-semibold tracking-[0.2em] text-slate-400 uppercase">
                Answer
              </p>
              <p className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {targetName}
              </p>
            </div>
          )}

          <form onSubmit={handleGuessSubmit} className="mx-auto mb-4 w-full max-w-xl">
            <label htmlFor="country-guess" className="mb-2 block text-sm font-medium text-slate-700">
              Enter country name
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <div className="relative min-w-0 flex-1">
                <input
                  id="country-guess"
                  role="combobox"
                  aria-expanded={!completed && filteredSuggestions.length > 0}
                  aria-controls="country-guess-listbox"
                  aria-autocomplete="list"
                  autoComplete="off"
                  value={guessValue}
                  onChange={(event) => setGuessValue(event.target.value)}
                  onKeyDown={handleGuessInputKeyDown}
                  disabled={completed}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                  placeholder="Start typing a country..."
                />
                {!completed && filteredSuggestions.length > 0 && (
                  <ul
                    id="country-guess-listbox"
                    role="listbox"
                    className="absolute top-full right-0 left-0 z-20 mt-1 max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                  >
                    {filteredSuggestions.map((suggestion) => (
                      <li
                        key={suggestion}
                        role="option"
                        aria-selected={suggestion === filteredSuggestions[0]}
                      >
                        <button
                          type="button"
                          className="w-full px-4 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-100"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setGuessValue(suggestion)}
                        >
                          {suggestion}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-stretch">
                <button
                  type="submit"
                  disabled={completed}
                  className="w-full shrink-0 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400 sm:w-auto sm:min-w-[6.5rem]"
                >
                  Guess
                </button>
                {mode === "unlimited" && !completed && (
                  <button
                    type="button"
                    onClick={revealUnlimitedAnswer}
                    className="w-full shrink-0 rounded-xl border-2 border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 sm:w-auto"
                  >
                    Reveal answer
                  </button>
                )}
              </div>
            </div>
          </form>

          <div className="mb-4 flex flex-wrap gap-2">
            {guesses.map((guess) => {
              const isCorrect = normalizeName(guess) === normalizeName(targetName);
              return (
                <span
                  key={guess}
                  className={`rounded-full px-3 py-1 text-sm font-medium ${
                    isCorrect
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {guess}
                </span>
              );
            })}
          </div>

          {completed && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-800">
                {won
                  ? `Correct in ${guesses.length} guess${guesses.length === 1 ? "" : "es"}`
                  : unlimitedRevealedEarly
                    ? "Answer revealed."
                    : "No more guesses left."}
              </p>
              {mode === "unlimited" && (
                <button
                  type="button"
                  onClick={startNextUnlimitedRound}
                  className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Next country
                </button>
              )}
            </div>
          )}

          <aside className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Daily streak</h2>
            <div className="grid grid-cols-2 gap-2 text-sm text-slate-700 sm:grid-cols-4">
              <p>Current: {dailyStats.streak}</p>
              <p>Best: {dailyStats.bestStreak}</p>
              <p>Wins: {dailyStats.wins}</p>
              <p>Losses: {dailyStats.losses}</p>
            </div>
          </aside>
        </section>
      )}
    </main>
  );
}
