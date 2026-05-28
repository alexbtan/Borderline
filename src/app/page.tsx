"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import countryAllowlist from "@/data/country-allowlist.json";
import {
  type CountryFeature,
  type FeatureCollection,
  DATASET_URL,
  buildCountryMapPath,
  getCountryCode,
  getCountryName,
} from "@/lib/country-geo";
import { useComboboxKeyboard } from "@/lib/use-combobox-keyboard";

type CountryAllowlistEntry = {
  code: string;
  name: string;
};

const ALLOWLIST_CODES = new Set(
  (countryAllowlist as CountryAllowlistEntry[]).map((entry) => entry.code),
);

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

const MAX_GUESSES = 6;
const STORAGE_STATS_KEY = "country-outline-daily-stats-v1";
const STORAGE_PROGRESS_KEY = "country-outline-daily-progress-v1";
const SVG_SIZE = 440;
const SVG_PADDING = 22;
const MAP_INNER_SIZE = SVG_SIZE - SVG_PADDING * 2;
const MIN_COUNTRY_MIN_EDGE_PX = 130;
const MAX_SMALL_COUNTRY_ZOOM = 5;
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
        const features = data.features.filter(
          (feature) =>
            getCountryName(feature) && ALLOWLIST_CODES.has(getCountryCode(feature)),
        );
        if (!features.length) {
          throw new Error("Allowlist produced no countries.");
        }
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
        const target = allCountries.find((country) => {
          if (
            savedProgress.targetId &&
            getCountryCode(country) === savedProgress.targetId
          ) {
            return true;
          }
          return (
            normalizeName(getCountryName(country)) ===
            normalizeName(savedProgress.targetName)
          );
        });

        if (!target) {
          const targetIndex = hashDateToIndex(today, allCountries.length);
          const newTarget = allCountries[targetIndex];
          const direction = getDailyRevealDirection(
            `${today}-${getCountryCode(newTarget) || getCountryName(newTarget)}`,
          );
          const newProgress: DailyProgress = {
            date: today,
            targetName: getCountryName(newTarget),
            targetId: getCountryCode(newTarget),
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
          return;
        }

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
        setTargetCountry(target);
        saveToStorage(STORAGE_PROGRESS_KEY, normalizedProgress);
      } else {
        const targetIndex = hashDateToIndex(today, allCountries.length);
        const newTarget = allCountries[targetIndex];
        const direction = getDailyRevealDirection(
          `${today}-${getCountryCode(newTarget) || getCountryName(newTarget)}`,
        );
        const newProgress: DailyProgress = {
          date: today,
          targetName: getCountryName(newTarget),
          targetId: getCountryCode(newTarget),
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

  const { highlightedIndex, setHighlightedIndex, setOptionRef, handleKeyDown } =
    useComboboxKeyboard({
      suggestions: filteredSuggestions,
      value: guessValue,
      setValue: setGuessValue,
      disabled: completed,
      isExactMatch: (input) =>
        countryNames.some(
          (countryName) => normalizeName(countryName) === normalizeName(input),
        ),
    });

  const renderShape = useMemo(() => {
    if (!targetCountry) {
      return { path: "", bounds: [[0, 0], [SVG_SIZE, SVG_SIZE]] as [[number, number], [number, number]] };
    }
    return buildCountryMapPath(targetCountry, {
      innerSize: MAP_INNER_SIZE,
      minCountryMinEdgePx: MIN_COUNTRY_MIN_EDGE_PX,
      maxSmallCountryZoom: MAX_SMALL_COUNTRY_ZOOM,
    });
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

  useEffect(() => {
    if (mode !== "unlimited" || !unlimitedAnswerRevealed || !allCountries.length) {
      return;
    }

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Enter" || event.repeat) {
        return;
      }
      event.preventDefault();
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

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [allCountries, mode, targetCountry, unlimitedAnswerRevealed]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-3 py-3 text-slate-100 sm:px-6 sm:py-4">
      <section className="mb-3 rounded-2xl border border-slate-700 bg-slate-900/80 p-3">
        <p className="mb-2 text-[0.65rem] font-semibold tracking-[0.18em] text-sky-300/60 uppercase">
          Game Series
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link
            href="/"
            className="rounded-xl border border-sky-500/50 bg-sky-900/40 px-3 py-2 text-sm text-sky-100"
          >
            <span className="block font-semibold">1) Partial Country Outlines</span>
            <span className="block text-xs text-sky-200/80">You are here</span>
          </Link>
          <Link
            href="/games/tradle"
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:border-sky-600"
          >
            <span className="block font-semibold">2) Trade Clues (OEC)</span>
            <span className="block text-xs text-slate-400">
              Guess countries from exports and imports
            </span>
          </Link>
          <Link
            href="/games/grid"
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:border-sky-600"
          >
            <span className="block font-semibold">3) Logic Grid</span>
            <span className="block text-xs text-slate-400">
              Deduce a country grid from chained clues
            </span>
          </Link>
        </div>
      </section>
      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <p className="text-[0.65rem] font-semibold tracking-[0.18em] text-sky-300/60 uppercase">
            Daily Geography Game
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Partial Country Outlines
          </h1>
        </div>
        <div className="inline-flex w-full rounded-xl border border-slate-700 bg-slate-950 p-1 sm:w-auto">
          {(["daily", "unlimited"] as GameMode[]).map((gameMode) => (
            <button
              type="button"
              key={gameMode}
              onClick={() => setMode(gameMode)}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition sm:flex-initial ${
                mode === gameMode
                  ? "bg-sky-700 text-slate-50 shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {gameMode === "daily" ? "Daily" : "Unlimited"}
            </button>
          ))}
        </div>
      </header>

      {loading && (
        <section className="rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center text-slate-300 shadow-sm">
          Loading country data...
        </section>
      )}

      {!loading && loadingError && (
        <section className="rounded-2xl border border-red-500/40 bg-red-950/50 p-6 text-center text-red-200 shadow-sm">
          {loadingError}
        </section>
      )}

      {!loading && !loadingError && targetCountry && (
        <section className="rounded-2xl border border-slate-700 bg-slate-900/95 p-3 shadow-2xl shadow-black/20 sm:p-4">
          <div className="mx-auto mb-3 aspect-square w-full max-w-[min(86vw,42dvh,22rem)] rounded-xl border border-slate-700 bg-slate-950 p-2">
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
                  fill="#2f5f86"
                  stroke="#8fb6d6"
                  strokeWidth="1.4"
                  mask="url(#reveal-mask)"
                />
              </g>
            </svg>
          </div>

          {!completed && (
            <p className="mb-3 text-center text-sm text-slate-400">
              Guess {guesses.length + 1} of {MAX_GUESSES}
            </p>
          )}

          {completed && (
            <div className="mx-auto mb-3 w-full max-w-xl rounded-2xl border border-sky-500/40 bg-sky-900 px-4 py-3 text-center shadow-lg shadow-black/30 sm:px-6 sm:py-4">
              <p className="text-[0.65rem] font-semibold tracking-[0.2em] text-sky-200/70 uppercase">
                Answer
              </p>
              <p className="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">
                {targetName}
              </p>
            </div>
          )}

          <form onSubmit={handleGuessSubmit} className="mx-auto mb-3 w-full max-w-xl">
            <label htmlFor="country-guess" className="mb-1.5 block text-sm font-medium text-slate-300">
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
                  onKeyDown={handleKeyDown}
                  disabled={completed}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-slate-100 shadow-sm outline-none transition placeholder:text-slate-500 focus:border-sky-600 focus:ring-2 focus:ring-sky-700/20 disabled:cursor-not-allowed disabled:bg-slate-800"
                  placeholder="Start typing a country..."
                />
                {!completed && filteredSuggestions.length > 0 && (
                  <ul
                    id="country-guess-listbox"
                    role="listbox"
                    className="mt-1 max-h-44 overflow-auto rounded-xl border border-slate-700 bg-slate-950 py-1 shadow-lg shadow-black/30 sm:absolute sm:top-full sm:right-0 sm:left-0 sm:z-20"
                  >
                    {filteredSuggestions.map((suggestion, index) => (
                      <li
                        key={suggestion}
                        ref={(element) => setOptionRef(index, element)}
                        role="option"
                        aria-selected={index === highlightedIndex}
                        onMouseEnter={() => setHighlightedIndex(index)}
                      >
                        <button
                          type="button"
                          className={`w-full px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-800 ${
                            index === highlightedIndex ? "bg-slate-800" : ""
                          }`}
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
                  className="w-full shrink-0 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 sm:w-auto sm:min-w-[6.5rem]"
                >
                  Guess
                </button>
                {mode === "unlimited" && !completed && (
                  <button
                    type="button"
                    onClick={revealUnlimitedAnswer}
                    className="w-full shrink-0 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-sky-600 hover:bg-slate-700 sm:w-auto"
                  >
                    Reveal answer
                  </button>
                )}
              </div>
            </div>
          </form>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {guesses.map((guess) => {
              const isCorrect = normalizeName(guess) === normalizeName(targetName);
              return (
                <span
                  key={guess}
                  className={`rounded-full px-3 py-1 text-sm font-medium ${
                    isCorrect
                      ? "bg-emerald-400 text-emerald-950"
                      : "bg-slate-800 text-slate-300"
                  }`}
                >
                  {guess}
                </span>
              );
            })}
          </div>

          {completed && (
            <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
              <p className="text-sm font-medium text-slate-300">
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
                  className="mt-2 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600"
                >
                  Next country
                </button>
              )}
            </div>
          )}

          <aside className="mt-3 rounded-xl border border-slate-700 bg-slate-950 p-3">
            <h2 className="mb-1.5 text-sm font-semibold text-slate-100">Daily streak</h2>
            <div className="grid grid-cols-2 gap-1.5 text-xs text-slate-400 sm:grid-cols-4">
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
