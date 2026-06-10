"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import figuresData from "@/data/historical-figures.json";
import figuresHardData from "@/data/historical-figures-hard.json";
import {
  type FeatureCollection,
  DATASET_URL,
} from "@/lib/country-geo";
import { useComboboxKeyboard } from "@/lib/use-combobox-keyboard";
import {
  buildLifeMapProjection,
  buildWorldCountryPaths,
  projectLatLon,
} from "@/lib/world-map";

type HistoricalFigure = {
  id: string;
  name: string;
  aliases?: string[];
  birthLat: number;
  birthLon: number;
  deathLat: number;
  deathLon: number;
  birthDate: string;
  deathDate: string;
};

type GameMode = "daily" | "unlimited";
type Difficulty = "normal" | "hard";

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

const FIGURES_NORMAL = figuresData as HistoricalFigure[];
const FIGURES_HARD = figuresHardData as HistoricalFigure[];

const MAX_GUESSES = 6;

function storageKeys(difficulty: Difficulty) {
  const suffix = difficulty === "hard" ? "hard" : "normal";
  return {
    stats: `figures-game-daily-stats-v1-${suffix}`,
    progress: `figures-game-daily-progress-v1-${suffix}`,
  };
}
const SVG_SIZE = 480;
const SVG_PADDING = 16;
const MAP_INNER_SIZE = SVG_SIZE - SVG_PADDING * 2;

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

function figureMatchesGuess(figure: HistoricalFigure, input: string) {
  const normalized = normalizeName(input);
  if (normalizeName(figure.name) === normalized) {
    return true;
  }
  return (figure.aliases ?? []).some((alias) => normalizeName(alias) === normalized);
}

function resolveFigureName(input: string, pool: HistoricalFigure[]) {
  const normalized = normalizeName(input);
  const match = pool.find((figure) => figureMatchesGuess(figure, normalized));
  return match?.name ?? null;
}

function dailySeed(today: string, difficulty: Difficulty) {
  return difficulty === "hard" ? `${today}-hard` : today;
}

function GameSeriesNav() {
  return (
    <section className="mb-3 rounded-2xl border border-slate-700 bg-slate-900/80 p-3">
      <p className="mb-2 text-[0.65rem] font-semibold tracking-[0.18em] text-sky-300/60 uppercase">
        Game Series
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/"
          className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:border-sky-600"
        >
          <span className="block font-semibold">1) Partial Country Outlines</span>
          <span className="block text-xs text-slate-400">Guess from partial silhouettes</span>
        </Link>
        <Link
          href="/games/tradle"
          className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:border-sky-600"
        >
          <span className="block font-semibold">2) Trade Clues (OEC)</span>
          <span className="block text-xs text-slate-400">Guess from exports and imports</span>
        </Link>
        <Link
          href="/games/grid"
          className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:border-sky-600"
        >
          <span className="block font-semibold">3) Logic Grid</span>
          <span className="block text-xs text-slate-400">Deduce a country grid from chained clues</span>
        </Link>
        <Link
          href="/games/figures"
          className="rounded-xl border border-sky-500/50 bg-sky-900/40 px-3 py-2 text-sm text-sky-100"
        >
          <span className="block font-semibold">4) Born & Died</span>
          <span className="block text-xs text-sky-200/80">You are here</span>
        </Link>
      </div>
    </section>
  );
}

export default function FiguresGamePage() {
  const [mode, setMode] = useState<GameMode>("daily");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [target, setTarget] = useState<HistoricalFigure | null>(null);
  const [guesses, setGuesses] = useState<string[]>([]);
  const [guessValue, setGuessValue] = useState("");
  const [dailyStats, setDailyStats] = useState<DailyStats>(defaultStats);
  const [dailyProgress, setDailyProgress] = useState<DailyProgress | null>(null);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const [loadingMap, setLoadingMap] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);

  const figures = difficulty === "hard" ? FIGURES_HARD : FIGURES_NORMAL;
  const { stats: statsKey, progress: progressKey } = storageKeys(difficulty);

  const figureNames = useMemo(
    () => figures.map((figure) => figure.name).sort((a, b) => a.localeCompare(b)),
    [figures],
  );

  const filteredSuggestions = useMemo(() => {
    const search = normalizeName(guessValue);
    if (!search) {
      return [];
    }
    return figureNames
      .filter((name) => normalizeName(name).includes(search))
      .slice(0, 7);
  }, [figureNames, guessValue]);

  const mapRender = useMemo(() => {
    if (!geojson || !target) {
      return null;
    }
    const projection = buildLifeMapProjection(
      { lat: target.birthLat, lon: target.birthLon },
      { lat: target.deathLat, lon: target.deathLon },
      MAP_INNER_SIZE,
    );
    const countryPaths = buildWorldCountryPaths(geojson, projection);
    const birthPoint = projectLatLon(projection, target.birthLat, target.birthLon);
    const deathPoint = projectLatLon(projection, target.deathLat, target.deathLon);
    return { countryPaths, birthPoint, deathPoint };
  }, [geojson, target]);

  useEffect(() => {
    const savedStats = loadFromStorage<DailyStats>(statsKey);
    setDailyStats(savedStats ?? defaultStats);
  }, [statsKey]);

  useEffect(() => {
    let cancelled = false;
    setLoadingMap(true);
    setMapError(null);
    fetch(DATASET_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load map data (${response.status})`);
        }
        return response.json() as Promise<FeatureCollection>;
      })
      .then((data) => {
        if (!cancelled) {
          setGeojson(data);
          setLoadingMap(false);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMapError(error instanceof Error ? error.message : "Failed to load map data");
          setLoadingMap(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!figures.length) {
      return;
    }
    if (mode === "daily") {
      setAnswerRevealed(false);
      const today = getTodayKey();
      const savedProgress = loadFromStorage<DailyProgress>(progressKey);
      const fromSaved =
        savedProgress?.date === today
          ? figures.find((figure) => figure.id === savedProgress.targetId)
          : null;
      const nextTarget =
        fromSaved ??
        figures[hashDateToIndex(dailySeed(today, difficulty), figures.length)];
      const nextProgress: DailyProgress =
        savedProgress?.date === today && fromSaved
          ? savedProgress
          : {
              date: today,
              targetId: nextTarget.id,
              guesses: [],
              completed: false,
              won: false,
            };
      setTarget(nextTarget);
      setGuesses(nextProgress.guesses);
      setDailyProgress(nextProgress);
      saveToStorage(progressKey, nextProgress);
      const revealedByButton =
        nextProgress.completed &&
        !nextProgress.won &&
        nextProgress.guesses.length < MAX_GUESSES;
      setAnswerRevealed(revealedByButton);
      return;
    }

    const randomFigure = figures[Math.floor(Math.random() * figures.length)];
    setTarget(randomFigure);
    setGuesses([]);
    setGuessValue("");
    setAnswerRevealed(false);
  }, [mode, difficulty, figures, progressKey]);

  const targetName = target?.name ?? "";
  const won = target ? guesses.some((guess) => figureMatchesGuess(target, guess)) : false;
  const lost = !won && guesses.length >= MAX_GUESSES;
  const completed = won || lost || answerRevealed;
  const revealedEarly = answerRevealed && !won && !lost;

  const { highlightedIndex, setHighlightedIndex, setOptionRef, handleKeyDown } =
    useComboboxKeyboard({
      suggestions: filteredSuggestions,
      value: guessValue,
      setValue: setGuessValue,
      disabled: completed,
      isExactMatch: (input) => resolveFigureName(input, figures) !== null,
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
    saveToStorage(statsKey, updatedStats);

    const updatedProgress: DailyProgress = {
      ...dailyProgress,
      guesses: nextGuesses,
      completed: true,
      won: isWin,
    };
    setDailyProgress(updatedProgress);
    saveToStorage(progressKey, updatedProgress);
  }

  function handleGuessSubmit(event: FormEvent) {
    event.preventDefault();
    if (!target || completed) {
      return;
    }
    const selectedName = resolveFigureName(guessValue, figures);
    if (!selectedName) {
      return;
    }
    if (guesses.some((guess) => normalizeName(guess) === normalizeName(selectedName))) {
      setGuessValue("");
      return;
    }
    const nextGuesses = [...guesses, selectedName];
    setGuesses(nextGuesses);
    setGuessValue("");
    const isWin = figureMatchesGuess(target, selectedName);
    const isLoss = !isWin && nextGuesses.length >= MAX_GUESSES;
    if (mode === "daily") {
      const nextProgress = dailyProgress ? { ...dailyProgress, guesses: nextGuesses } : null;
      if (nextProgress) {
        setDailyProgress(nextProgress);
        saveToStorage(progressKey, nextProgress);
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
    if (mode !== "unlimited" || !figures.length) {
      return;
    }
    let nextFigure = figures[Math.floor(Math.random() * figures.length)];
    if (target && figures.length > 1) {
      let guard = 0;
      while (nextFigure.id === target.id && guard < 24) {
        nextFigure = figures[Math.floor(Math.random() * figures.length)];
        guard += 1;
      }
    }
    setTarget(nextFigure);
    setGuesses([]);
    setGuessValue("");
    setAnswerRevealed(false);
  }

  if (!figures.length) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-3 py-3 text-slate-100 sm:px-6 sm:py-4">
        <GameSeriesNav />
        <p className="text-red-300">
          No figures in the game pool. Add entries to{" "}
          <code className="text-red-200">
            src/data/{difficulty === "hard" ? "historical-figures-hard.json" : "historical-figures.json"}
          </code>
          .
        </p>
      </main>
    );
  }

  if (!target) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-3 py-3 text-slate-100 sm:px-6 sm:py-4">
        <GameSeriesNav />
        <p className="text-slate-400">Loading figure data...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-3 py-3 text-slate-100 sm:px-6 sm:py-4">
      <GameSeriesNav />

      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <p className="text-[0.65rem] font-semibold tracking-[0.18em] text-sky-300/60 uppercase">
            Historical Geography
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Born & Died
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-slate-400">
            Two dots mark where someone was born and died. Use the dates and map to guess who it is.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto">
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
          <div className="inline-flex w-full rounded-xl border border-slate-700 bg-slate-950 p-1 sm:w-auto">
            {(["normal", "hard"] as Difficulty[]).map((level) => (
              <button
                type="button"
                key={level}
                onClick={() => setDifficulty(level)}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition sm:flex-initial ${
                  difficulty === level
                    ? level === "hard"
                      ? "bg-rose-800 text-rose-50 shadow"
                      : "bg-sky-700 text-slate-50 shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {level === "normal" ? "Normal" : "Hard"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="mb-3 rounded-2xl border border-slate-700 bg-slate-900/95 p-3 shadow-2xl shadow-black/20 sm:p-4">
        {loadingMap && (
          <p className="py-16 text-center text-slate-400">Loading map data...</p>
        )}

        {!loadingMap && mapError && (
          <p className="py-16 text-center text-red-300">{mapError}</p>
        )}

        {!loadingMap && !mapError && mapRender && (
          <>
            <div className="mx-auto mb-3 aspect-square w-full max-w-[min(92vw,36rem)] rounded-xl border border-slate-700 bg-slate-950 p-2">
              <svg viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} className="h-full w-full">
                <g transform={`translate(${SVG_PADDING}, ${SVG_PADDING})`}>
                  {mapRender.countryPaths.map((country) => (
                    <path
                      key={country.id}
                      d={country.path}
                      fill="#1e293b"
                      stroke="#475569"
                      strokeWidth={0.4}
                    />
                  ))}
                  {mapRender.birthPoint && (
                    <circle
                      cx={mapRender.birthPoint[0]}
                      cy={mapRender.birthPoint[1]}
                      r={7}
                      fill="#34d399"
                      stroke="#ecfdf5"
                      strokeWidth={2}
                    />
                  )}
                  {mapRender.deathPoint && (
                    <circle
                      cx={mapRender.deathPoint[0]}
                      cy={mapRender.deathPoint[1]}
                      r={7}
                      fill="#fb7185"
                      stroke="#fff1f2"
                      strokeWidth={2}
                    />
                  )}
                </g>
              </svg>
              <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-slate-300">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  Born
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-400" />
                  Died
                </span>
              </div>
            </div>

            <div className="mx-auto mb-3 grid w-full max-w-xl gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-3 text-center">
                <p className="text-[0.65rem] font-semibold tracking-[0.18em] text-emerald-300/70 uppercase">
                  Born
                </p>
                <p className="mt-1 text-sm font-medium text-emerald-100">{target.birthDate}</p>
              </div>
              <div className="rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-center">
                <p className="text-[0.65rem] font-semibold tracking-[0.18em] text-rose-300/70 uppercase">
                  Died
                </p>
                <p className="mt-1 text-sm font-medium text-rose-100">{target.deathDate}</p>
              </div>
            </div>
          </>
        )}
      </section>

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
          <p className="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">{targetName}</p>
        </div>
      )}

      <form onSubmit={handleGuessSubmit} className="mx-auto mb-3 w-full max-w-xl">
        <label htmlFor="figure-guess" className="mb-1.5 block text-sm font-medium text-slate-300">
          Enter historical figure
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <div className="relative min-w-0 flex-1">
            <input
              id="figure-guess"
              role="combobox"
              aria-expanded={!completed && filteredSuggestions.length > 0}
              aria-controls="figure-guess-listbox"
              aria-autocomplete="list"
              autoComplete="off"
              value={guessValue}
              onChange={(event) => setGuessValue(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={completed}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-slate-100 shadow-sm outline-none transition placeholder:text-slate-500 focus:border-sky-600 focus:ring-2 focus:ring-sky-700/20 disabled:cursor-not-allowed disabled:bg-slate-800"
              placeholder="Start typing a name..."
            />
            {!completed && filteredSuggestions.length > 0 && (
              <ul
                id="figure-guess-listbox"
                role="listbox"
                className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-xl border border-slate-700 bg-slate-950 py-1 shadow-xl"
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
          const isCorrect = target ? figureMatchesGuess(target, guess) : false;
          return (
            <span
              key={guess}
              className={`inline-flex max-w-full items-center rounded-full px-3 py-1 text-sm font-medium ${
                isCorrect ? "bg-emerald-400 text-emerald-950" : "bg-slate-800 text-slate-300"
              }`}
            >
              <span className="min-w-0 truncate">{guess}</span>
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
              Next figure
            </button>
          )}
        </div>
      )}

      <aside className="mt-3 rounded-xl border border-slate-700 bg-slate-950 p-3">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-100">
          Daily streak ({difficulty === "hard" ? "Hard" : "Normal"})
        </h2>
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
