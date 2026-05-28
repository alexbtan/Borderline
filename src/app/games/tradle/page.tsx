"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import countryAllowlistOec from "@/data/country-allowlist-oec.json";
import capitalsData from "@/data/country-capitals-oec.json";
import tradeData from "@/data/oec-trade-game-data.json";
import { HS_SECTIONS, getSection, getSectionId } from "@/lib/hs-sections";
import { squarify } from "@/lib/treemap";
import { useComboboxKeyboard } from "@/lib/use-combobox-keyboard";

type GameMode = "daily" | "unlimited";

type TradeItem = {
  code: string;
  product: string;
  value: number;
  share: number;
};

type TradeCountry = {
  oecId: string;
  iso3: string;
  name: string;
  year: number;
  exports: TradeItem[];
  imports: TradeItem[];
};

type CapitalEntry = {
  iso3: string;
  country: string;
  capital: string | null;
  lat: number | null;
  lon: number | null;
};

type DailyStats = {
  streak: number;
  bestStreak: number;
  wins: number;
  losses: number;
  lastCompletedDate: string | null;
};

type DailyProgress = {
  date: string;
  targetId: string;
  guesses: string[];
  completed: boolean;
  won: boolean;
};

type OecAllowlistEntry = {
  oecId: string;
  iso3: string;
  name: string;
};

const ALLOWED_OEC_IDS = new Set(
  (countryAllowlistOec as OecAllowlistEntry[]).map((entry) => entry.oecId),
);

const COUNTRIES = (tradeData as TradeCountry[]).filter((country) =>
  ALLOWED_OEC_IDS.has(country.oecId),
);
const CAPITALS = capitalsData as CapitalEntry[];
const MAX_GUESSES = 6;
const STORAGE_STATS_KEY = "trade-game-daily-stats-v1";
const STORAGE_PROGRESS_KEY = "trade-game-daily-progress-v1";
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

function normalizeName(value: string) {
  return value.trim().toLowerCase();
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

function formatUsd(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial bearing from (lat1,lon1) to (lat2,lon2) in degrees: 0 = N, 90 = E, clockwise. */
function bearingDegrees(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return (toDeg(θ) + 360) % 360;
}

function DirectionArrow({ degrees }: { degrees: number }) {
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-sky-600 text-white shadow-sm"
      title={`Toward answer: ${Math.round(degrees)}°`}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3 w-3"
        style={{ transform: `rotate(${degrees}deg)` }}
      >
        <path
          fill="currentColor"
          d="M12 4 L20 18 L12 14.5 L4 18 Z"
        />
      </svg>
    </span>
  );
}

function Treemap({
  title,
  items,
  total,
}: {
  title: string;
  items: TradeItem[];
  total: number;
}) {
  const [activeSection, setActiveSection] = useState<number | null>(null);

  const sectionSummaries = useMemo(() => {
    const map = new Map<number, { id: number; value: number; items: TradeItem[] }>();
    for (const item of items) {
      const sectionId = getSectionId(item.code);
      const entry = map.get(sectionId) ?? { id: sectionId, value: 0, items: [] };
      entry.value += item.value;
      entry.items.push(item);
      map.set(sectionId, entry);
    }
    return [...map.values()]
      .map((entry) => ({
        ...entry,
        items: entry.items.sort((a, b) => b.value - a.value),
      }))
      .sort((a, b) => b.value - a.value);
  }, [items]);

  const placements = useMemo(() => {
    const rect = { x: 0, y: 0, w: 100, h: 100 };
    if (activeSection !== null) {
      const sectionData = sectionSummaries.find((entry) => entry.id === activeSection);
      if (!sectionData) {
        return [];
      }
      return squarify(
        sectionData.items.map((item) => ({
          ...item,
          sectionId: sectionData.id,
        })),
        rect,
      );
    }
    const sectionRects = squarify(
      sectionSummaries.map((entry) => ({ ...entry })),
      rect,
    );
    return sectionRects.flatMap((sectionRect) =>
      squarify(
        sectionRect.items.map((item) => ({ ...item, sectionId: sectionRect.id })),
        {
          x: sectionRect.x,
          y: sectionRect.y,
          w: sectionRect.w,
          h: sectionRect.h,
        },
      ),
    );
  }, [activeSection, sectionSummaries]);

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        <p className="text-xs text-slate-400">
          Total: <span className="font-semibold text-white">${formatUsd(total)}</span>
        </p>
      </div>

      <div className="relative aspect-[5/4] w-full overflow-hidden rounded-md border border-slate-700 bg-slate-950">
        {placements.map((placement) => {
          const section = HS_SECTIONS[placement.sectionId] ?? getSection(placement.code);
          const widthPct = placement.w;
          const heightPct = placement.h;
          const minEdge = Math.min(widthPct, heightPct);
          const showName = widthPct >= 9 && heightPct >= 7;
          const showShare = widthPct >= 6 && heightPct >= 5;
          const nameFont =
            minEdge >= 18
              ? "text-[0.78rem]"
              : minEdge >= 12
                ? "text-[0.66rem]"
                : "text-[0.55rem]";
          const shareFont = minEdge >= 14 ? "text-[0.66rem]" : "text-[0.5rem]";
          return (
            <div
              key={`${title}-${placement.code}`}
              title={`${placement.product} - ${(placement.share * 100).toFixed(2)}% ($${formatUsd(placement.value)})`}
              className="group absolute overflow-hidden border border-white/40 p-1 leading-tight text-slate-900"
              style={{
                left: `${placement.x}%`,
                top: `${placement.y}%`,
                width: `${widthPct}%`,
                height: `${heightPct}%`,
                backgroundColor: section.color,
                transition:
                  "left 320ms ease, top 320ms ease, width 320ms ease, height 320ms ease, opacity 220ms ease",
              }}
            >
              {showName && (
                <p className={`line-clamp-3 overflow-hidden break-words font-semibold ${nameFont}`}>
                  {placement.product}
                </p>
              )}
              {showShare && (
                <p className={`overflow-hidden text-ellipsis whitespace-nowrap opacity-90 ${shareFont}`}>
                  {(placement.share * 100).toFixed(1)}% • ${formatUsd(placement.value)}
                </p>
              )}
              <div className="pointer-events-none absolute top-1 left-1 z-20 max-w-[90%] -translate-y-1 rounded bg-slate-900/95 px-2 py-1 text-[0.62rem] font-medium text-slate-100 opacity-0 shadow-lg transition duration-150 group-hover:translate-y-0 group-hover:opacity-100">
                <span className="block truncate">{placement.product}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setActiveSection(null)}
          className={`rounded px-2 py-1 text-[0.65rem] font-semibold ${
            activeSection === null
              ? "bg-slate-100 text-slate-900"
              : "border border-slate-600 bg-slate-800 text-slate-200"
          }`}
        >
          All
        </button>
        {sectionSummaries.map((entry) => {
          const section = HS_SECTIONS[entry.id];
          if (!section) {
            return null;
          }
          const isActive = activeSection === entry.id;
          return (
            <button
              type="button"
              key={`${title}-section-${entry.id}`}
              title={`${section.label} - ${((entry.value / total) * 100).toFixed(1)}%`}
              onClick={() => setActiveSection(isActive ? null : entry.id)}
              className={`rounded px-2 py-1 text-[0.65rem] font-semibold transition ${
                isActive
                  ? "text-slate-900 ring-2 ring-white"
                  : "text-slate-900 hover:opacity-90"
              }`}
              style={{ backgroundColor: section.color }}
            >
              {section.short}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function TradeGamePage() {
  const [mode, setMode] = useState<GameMode>("daily");
  const [target, setTarget] = useState<TradeCountry | null>(null);
  const [guesses, setGuesses] = useState<string[]>([]);
  const [guessValue, setGuessValue] = useState("");
  const [dailyStats, setDailyStats] = useState<DailyStats>(defaultStats);
  const [dailyProgress, setDailyProgress] = useState<DailyProgress | null>(null);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const capitalsByIso3 = useMemo(
    () => new Map(CAPITALS.map((entry) => [entry.iso3, entry])),
    [],
  );
  const countriesByName = useMemo(
    () => new Map(COUNTRIES.map((country) => [normalizeName(country.name), country])),
    [],
  );

  const countryNames = useMemo(
    () => COUNTRIES.map((country) => country.name).sort((a, b) => a.localeCompare(b)),
    [],
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

  useEffect(() => {
    const savedStats = loadFromStorage<DailyStats>(STORAGE_STATS_KEY);
    if (savedStats) {
      setDailyStats(savedStats);
    }
  }, []);

  useEffect(() => {
    if (!COUNTRIES.length) {
      return;
    }
    if (mode === "daily") {
      setAnswerRevealed(false);
      const today = getTodayKey();
      const savedProgress = loadFromStorage<DailyProgress>(STORAGE_PROGRESS_KEY);
      const fromSaved =
        savedProgress?.date === today
          ? COUNTRIES.find((country) => country.oecId === savedProgress.targetId)
          : null;
      const nextTarget = fromSaved ?? COUNTRIES[hashDateToIndex(today, COUNTRIES.length)];
      const nextProgress: DailyProgress =
        savedProgress?.date === today && fromSaved
          ? savedProgress
          : {
              date: today,
              targetId: nextTarget.oecId,
              guesses: [],
              completed: false,
              won: false,
            };
      setTarget(nextTarget);
      setGuesses(nextProgress.guesses);
      setDailyProgress(nextProgress);
      saveToStorage(STORAGE_PROGRESS_KEY, nextProgress);
      const revealedByButton =
        nextProgress.completed &&
        !nextProgress.won &&
        nextProgress.guesses.length < MAX_GUESSES;
      setAnswerRevealed(revealedByButton);
      return;
    }

    const randomCountry = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
    setTarget(randomCountry);
    setGuesses([]);
    setGuessValue("");
    setAnswerRevealed(false);
  }, [mode]);

  const targetName = target?.name ?? "";
  const targetCapital = target ? capitalsByIso3.get(target.iso3) : null;
  const totalExports = useMemo(
    () => target?.exports.reduce((sum, item) => sum + item.value, 0) ?? 0,
    [target],
  );
  const totalImports = useMemo(
    () => target?.imports.reduce((sum, item) => sum + item.value, 0) ?? 0,
    [target],
  );
  const won = guesses.some((guess) => normalizeName(guess) === normalizeName(targetName));
  const lost = !won && guesses.length >= MAX_GUESSES;
  const completed = won || lost || answerRevealed;
  const revealedEarly = answerRevealed && !won && !lost;

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
    if (!target || completed) {
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
      const nextProgress = dailyProgress ? { ...dailyProgress, guesses: nextGuesses } : null;
      if (nextProgress) {
        setDailyProgress(nextProgress);
        saveToStorage(STORAGE_PROGRESS_KEY, nextProgress);
      }
      if (isWin || isLoss) {
        updateDailyAfterCompletion(isWin, nextGuesses);
      }
    }
  }

  function revealAnswer() {
    if (!target || completed) {
      return;
    }
    setAnswerRevealed(true);
    setGuessValue("");
    if (mode === "daily") {
      updateDailyAfterCompletion(false, guesses);
    }
  }

  function startNextUnlimitedRound() {
    if (mode !== "unlimited" || !COUNTRIES.length) {
      return;
    }
    let nextCountry = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
    if (target && COUNTRIES.length > 1) {
      let guard = 0;
      while (nextCountry.oecId === target.oecId && guard < 24) {
        nextCountry = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
        guard += 1;
      }
    }
    setTarget(nextCountry);
    setGuesses([]);
    setGuessValue("");
    setAnswerRevealed(false);
  }

  if (!COUNTRIES.length) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-3 py-3 text-slate-100 sm:px-6 sm:py-4">
        <p className="text-red-300">
          No countries in the game pool. Add entries to{" "}
          <code className="text-red-200">src/data/country-allowlist-oec.json</code> that exist in{" "}
          <code className="text-red-200">oec-trade-game-data.json</code>.
        </p>
      </main>
    );
  }

  if (!target) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-3 py-3 text-slate-100 sm:px-6 sm:py-4">
        <p className="text-slate-400">Loading OEC trade data...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-3 py-3 text-slate-100 sm:px-6 sm:py-4">
      <section className="mb-3 rounded-2xl border border-slate-700 bg-slate-900/80 p-3">
        <p className="mb-2 text-[0.65rem] font-semibold tracking-[0.18em] text-sky-300/60 uppercase">
          Game Series
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link
            href="/"
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:border-sky-600"
          >
            <span className="block font-semibold">1) Partial Country Outlines</span>
            <span className="block text-xs text-slate-400">Guess from partial silhouettes</span>
          </Link>
          <Link
            href="/games/tradle"
            className="rounded-xl border border-sky-500/50 bg-sky-900/40 px-3 py-2 text-sm text-sky-100"
          >
            <span className="block font-semibold">2) Trade Clues (OEC)</span>
            <span className="block text-xs text-sky-200/80">You are here</span>
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
            OEC Trade Game
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Exports & Imports
          </h1>
          <p className="mt-1 text-xs text-slate-400">Data year: {target.year}</p>
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

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <Treemap title="Exports" items={target.exports} total={totalExports} />
        <Treemap title="Imports" items={target.imports} total={totalImports} />
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
          <p className="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">{target.name}</p>
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
            {!completed && (
              <button
                type="button"
                onClick={revealAnswer}
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
          const isCorrect = normalizeName(guess) === normalizeName(target.name);
          const guessedCountry = countriesByName.get(normalizeName(guess));
          const guessedCapital = guessedCountry ? capitalsByIso3.get(guessedCountry.iso3) : null;
          const hasCoords =
            guessedCapital?.lat != null &&
            guessedCapital?.lon != null &&
            targetCapital?.lat != null &&
            targetCapital?.lon != null;
          const distanceKm = hasCoords
            ? haversineDistanceKm(
                guessedCapital.lat!,
                guessedCapital.lon!,
                targetCapital.lat!,
                targetCapital.lon!,
              )
            : null;
          const bearingDeg = hasCoords
            ? bearingDegrees(
                guessedCapital.lat!,
                guessedCapital.lon!,
                targetCapital.lat!,
                targetCapital.lon!,
              )
            : null;
          return (
            <span
              key={guess}
              className={`inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
                isCorrect ? "bg-emerald-400 text-emerald-950" : "bg-slate-800 text-slate-300"
              }`}
            >
              <span className="min-w-0 truncate">{guess}</span>
              {!isCorrect && distanceKm !== null && bearingDeg !== null && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-300">
                  <DirectionArrow degrees={bearingDeg} />
                  <span>{Math.round(distanceKm).toLocaleString("en")} km</span>
                </span>
              )}
            </span>
          );
        })}
      </div>

      {completed && (
        <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
          <p className="text-sm font-medium text-slate-300">
            {won
              ? `Correct in ${guesses.length} guess${guesses.length === 1 ? "" : "es"}`
              : revealedEarly
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
    </main>
  );
}
