"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  cellKey,
  colLetter,
  generatePuzzle,
  getAllCountryNames,
  getDims,
  parseCell,
  type Difficulty,
} from "@/lib/logic-grid/generate";
import type { Puzzle } from "@/lib/logic-grid/types";
import { useComboboxKeyboard } from "@/lib/use-combobox-keyboard";

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
  placed: string[];
  mistakes: number;
  hints: number;
  completed: boolean;
  won: boolean;
  revealed: boolean;
};

const STORAGE_STATS_KEY = "logic-grid-daily-stats-v1";
const STORAGE_PROGRESS_KEY = "logic-grid-daily-progress-v1";
const DAILY_DIFFICULTY: Difficulty = "medium";

const ALL_NAMES = getAllCountryNames();
const NAME_SET = new Set(ALL_NAMES.map((n) => n.toLowerCase()));

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

function getYesterdayKey() {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
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

function solutionIso(puzzle: Puzzle, key: string): string {
  const { row, col } = parseCell(key);
  return puzzle.solution[row][col];
}

export default function LogicGridPage() {
  const [mode, setMode] = useState<GameMode>("daily");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [unlimitedSeed, setUnlimitedSeed] = useState(() => `u-${Date.now()}`);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [guessValue, setGuessValue] = useState("");
  const [wrongCell, setWrongCell] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [hints, setHints] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [dailyStats, setDailyStats] = useState<DailyStats>(defaultStats);
  const [dailyProgress, setDailyProgress] = useState<DailyProgress | null>(null);

  useEffect(() => {
    const savedStats = loadFromStorage<DailyStats>(STORAGE_STATS_KEY);
    if (savedStats) {
      setDailyStats(savedStats);
    }
  }, []);

  useEffect(() => {
    setSelectedCell(null);
    setGuessValue("");
    setWrongCell(null);

    if (mode === "daily") {
      const today = getTodayKey();
      const next = generatePuzzle(`grid-daily-${today}`, DAILY_DIFFICULTY);
      const saved = loadFromStorage<DailyProgress>(STORAGE_PROGRESS_KEY);
      const restored = saved?.date === today ? saved : null;
      const placedMap: Record<string, string> = {
        [next.seedCell]: solutionIso(next, next.seedCell),
      };
      if (restored) {
        for (const key of restored.placed) {
          placedMap[key] = solutionIso(next, key);
        }
      }
      setPuzzle(next);
      setPlaced(placedMap);
      setMistakes(restored?.mistakes ?? 0);
      setHints(restored?.hints ?? 0);
      setRevealed(restored?.revealed ?? false);
      const progress: DailyProgress = restored ?? {
        date: today,
        placed: [],
        mistakes: 0,
        hints: 0,
        completed: false,
        won: false,
        revealed: false,
      };
      setDailyProgress(progress);
      if (!restored) {
        saveToStorage(STORAGE_PROGRESS_KEY, progress);
      }
      return;
    }

    const next = generatePuzzle(`grid-${difficulty}-${unlimitedSeed}`, difficulty);
    setPuzzle(next);
    setPlaced({ [next.seedCell]: solutionIso(next, next.seedCell) });
    setMistakes(0);
    setHints(0);
    setRevealed(false);
  }, [mode, difficulty, unlimitedSeed]);

  const total = puzzle ? puzzle.rows * puzzle.cols : 0;
  const placedCount = Object.keys(placed).length;
  const solved = total > 0 && placedCount === total;
  const completed = solved || revealed;
  const won = solved && !revealed;

  const suggestions = useMemo(() => {
    const search = normalizeName(guessValue);
    if (!search) {
      return [];
    }
    return ALL_NAMES.filter((name) => name.toLowerCase().includes(search)).slice(0, 7);
  }, [guessValue]);

  const { highlightedIndex, setHighlightedIndex, setOptionRef, handleKeyDown } =
    useComboboxKeyboard({
      suggestions,
      value: guessValue,
      setValue: setGuessValue,
      disabled: completed || !selectedCell,
      isExactMatch: (input) => NAME_SET.has(normalizeName(input)),
    });

  function persistDaily(nextPlaced: Record<string, string>, patch: Partial<DailyProgress>) {
    if (mode !== "daily" || !puzzle) {
      return;
    }
    const base = dailyProgress ?? {
      date: getTodayKey(),
      placed: [],
      mistakes: 0,
      hints: 0,
      completed: false,
      won: false,
      revealed: false,
    };
    const next: DailyProgress = {
      ...base,
      placed: Object.keys(nextPlaced).filter((key) => key !== puzzle.seedCell),
      ...patch,
    };
    setDailyProgress(next);
    saveToStorage(STORAGE_PROGRESS_KEY, next);
  }

  function recordCompletion(isWin: boolean) {
    if (mode !== "daily" || dailyProgress?.completed) {
      return;
    }
    const today = getTodayKey();
    const yesterday = getYesterdayKey();
    const nextStreak =
      isWin && dailyStats.lastCompletedDate === yesterday
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
  }

  function placeCountry(key: string, iso: string, viaHint: boolean) {
    if (!puzzle) {
      return;
    }
    const nextPlaced = { ...placed, [key]: iso };
    setPlaced(nextPlaced);
    setSelectedCell(null);
    setGuessValue("");
    const nowSolved = Object.keys(nextPlaced).length === puzzle.rows * puzzle.cols;
    if (mode === "daily") {
      persistDaily(nextPlaced, {
        ...(viaHint ? { hints: hints + 1 } : {}),
        ...(nowSolved ? { completed: true, won: true } : {}),
      });
      if (nowSolved) {
        recordCompletion(true);
      }
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!puzzle || completed || !selectedCell) {
      return;
    }
    const input = normalizeName(guessValue);
    if (!NAME_SET.has(input)) {
      return;
    }
    const correctIso = solutionIso(puzzle, selectedCell);
    const correctName = normalizeName(puzzle.countries[correctIso].name);
    if (input === correctName) {
      placeCountry(selectedCell, correctIso, false);
    } else {
      const wrong = selectedCell;
      setMistakes((m) => {
        const next = m + 1;
        if (mode === "daily") {
          persistDaily(placed, { mistakes: next });
        }
        return next;
      });
      setGuessValue("");
      setWrongCell(wrong);
      window.setTimeout(() => setWrongCell(null), 500);
    }
  }

  function handleCellClick(key: string) {
    if (!puzzle || completed || placed[key]) {
      return;
    }
    setGuessValue("");
    setSelectedCell((current) => (current === key ? null : key));
  }

  function useHint() {
    if (!puzzle || completed) {
      return;
    }
    const nextKey = puzzle.solveOrder.find((key) => !placed[key]);
    if (!nextKey) {
      return;
    }
    setHints((h) => h + 1);
    placeCountry(nextKey, solutionIso(puzzle, nextKey), true);
  }

  function revealSolution() {
    if (!puzzle || completed) {
      return;
    }
    const full: Record<string, string> = {};
    for (let r = 0; r < puzzle.rows; r += 1) {
      for (let c = 0; c < puzzle.cols; c += 1) {
        full[cellKey(r, c)] = puzzle.solution[r][c];
      }
    }
    setPlaced(full);
    setRevealed(true);
    setSelectedCell(null);
    setGuessValue("");
    if (mode === "daily") {
      persistDaily(full, { completed: true, won: false, revealed: true });
      recordCompletion(false);
    }
  }

  function newUnlimitedPuzzle() {
    setUnlimitedSeed(`u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  }

  if (!puzzle) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-3 py-3 text-slate-100 sm:px-6 sm:py-4">
        <p className="text-slate-400">Building puzzle...</p>
      </main>
    );
  }

  const dims = getDims(mode === "daily" ? DAILY_DIFFICULTY : difficulty);

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
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:border-sky-600"
          >
            <span className="block font-semibold">2) Trade Clues (OEC)</span>
            <span className="block text-xs text-slate-400">Guess from exports and imports</span>
          </Link>
          <Link
            href="/games/grid"
            className="rounded-xl border border-sky-500/50 bg-sky-900/40 px-3 py-2 text-sm text-sky-100"
          >
            <span className="block font-semibold">3) Logic Grid</span>
            <span className="block text-xs text-sky-200/80">You are here</span>
          </Link>
        </div>
      </section>

      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <p className="text-[0.65rem] font-semibold tracking-[0.18em] text-sky-300/60 uppercase">
            Deductive Geography
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Geo Logic Grid
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-slate-400">
            Start from one filled box and its clue. Each box you solve reveals new clues that
            identify another box. Every row is a single, distinct continent — deduce which.
            North/south clues compare capital cities.
          </p>
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

      {mode === "unlimited" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-400">Difficulty:</span>
          {(["easy", "medium", "hard"] as Difficulty[]).map((level) => {
            const levelDims = getDims(level);
            return (
              <button
                type="button"
                key={level}
                onClick={() => setDifficulty(level)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
                  difficulty === level
                    ? "bg-sky-700 text-white"
                    : "border border-slate-700 bg-slate-900 text-slate-300 hover:border-sky-600"
                }`}
              >
                {level} ({levelDims.rows}x{levelDims.cols})
              </button>
            );
          })}
          <button
            type="button"
            onClick={newUnlimitedPuzzle}
            className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            New puzzle
          </button>
        </div>
      )}

      {/* Input bar */}
      {!completed && (
        <form
          onSubmit={handleSubmit}
          className="mb-3 rounded-2xl border border-slate-700 bg-slate-900/80 p-3"
        >
          {selectedCell ? (
            <label htmlFor="grid-guess" className="mb-1.5 block text-sm font-medium text-sky-200">
              Which country goes in {selectedCell}?
            </label>
          ) : (
            <p className="mb-1.5 text-sm text-slate-400">
              Click an empty box, then type the country the clues point to.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <div className="relative min-w-0 flex-1">
              <input
                id="grid-guess"
                key={selectedCell ?? "none"}
                role="combobox"
                aria-expanded={Boolean(selectedCell) && suggestions.length > 0}
                aria-controls="grid-guess-listbox"
                aria-autocomplete="list"
                autoComplete="off"
                autoFocus={Boolean(selectedCell)}
                value={guessValue}
                onChange={(event) => setGuessValue(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!selectedCell}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-slate-100 shadow-sm outline-none transition placeholder:text-slate-500 focus:border-sky-600 focus:ring-2 focus:ring-sky-700/20 disabled:cursor-not-allowed disabled:bg-slate-800"
                placeholder={selectedCell ? "Type a country..." : "Select a box first"}
              />
              {selectedCell && suggestions.length > 0 && (
                <ul
                  id="grid-guess-listbox"
                  role="listbox"
                  className="mt-1 max-h-44 overflow-auto rounded-xl border border-slate-700 bg-slate-950 py-1 shadow-lg shadow-black/30 sm:absolute sm:top-full sm:right-0 sm:left-0 sm:z-20"
                >
                  {suggestions.map((suggestion, index) => (
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
            <button
              type="submit"
              disabled={!selectedCell}
              className="w-full shrink-0 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 sm:w-auto sm:min-w-[6.5rem]"
            >
              Place
            </button>
          </div>
        </form>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span>
          Placed <span className="font-semibold text-white">{placedCount}</span> / {total}
        </span>
        <span>
          Mistakes <span className="font-semibold text-amber-300">{mistakes}</span>
          {hints > 0 && (
            <>
              {" "}
              · Hints <span className="font-semibold text-amber-300">{hints}</span>
            </>
          )}
        </span>
      </div>

      {/* Grid */}
      <div className="mb-3 overflow-x-auto">
        <div
          className="grid min-w-fit gap-1"
          style={{
            gridTemplateColumns: `1.25rem repeat(${dims.cols}, minmax(9rem, 1fr))`,
          }}
        >
          <div />
          {Array.from({ length: dims.cols }).map((_, c) => (
            <div
              key={`col-${c}`}
              className="pb-0.5 text-center text-[0.65rem] font-bold tracking-widest text-slate-500"
            >
              {colLetter(c)}
            </div>
          ))}

          {Array.from({ length: dims.rows }).map((_, r) => (
            <RowFragment
              key={`row-${r}`}
              rowIndex={r}
              cols={dims.cols}
              puzzle={puzzle}
              placed={placed}
              selectedCell={selectedCell}
              wrongCell={wrongCell}
              revealed={revealed}
              onCellClick={handleCellClick}
            />
          ))}
        </div>
      </div>

      {completed ? (
        <div
          className={`mb-3 rounded-2xl border px-4 py-3 text-center shadow-lg shadow-black/30 ${
            won
              ? "border-emerald-500/50 bg-emerald-900/40"
              : "border-amber-500/40 bg-amber-900/30"
          }`}
        >
          <p className="text-lg font-bold text-white">
            {won ? "Solved!" : "Solution revealed"}
          </p>
          <p className="mt-1 text-sm text-slate-300">
            {won
              ? `Completed with ${mistakes} mistake${mistakes === 1 ? "" : "s"}${
                  hints > 0 ? ` and ${hints} hint${hints === 1 ? "" : "s"}` : ""
                }.`
              : "Study the clues and try the next one."}
          </p>
          {mode === "unlimited" && (
            <button
              type="button"
              onClick={newUnlimitedPuzzle}
              className="mt-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600"
            >
              New puzzle
            </button>
          )}
        </div>
      ) : (
        <div className="mb-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={useHint}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:border-sky-600 hover:bg-slate-700"
          >
            Hint
          </button>
          <button
            type="button"
            onClick={revealSolution}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:border-amber-500 hover:bg-slate-700"
          >
            Reveal solution
          </button>
        </div>
      )}

      {completed && puzzle.logicFlow.length > 0 && (
        <section className="mb-3 rounded-2xl border border-slate-700 bg-slate-950 p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-100">Logic walkthrough</h2>
          <p className="mb-3 text-xs text-slate-400">
            How the puzzle unfolds step by step. North/south clues compare capital cities, not
            country centroids.
          </p>
          <ol className="space-y-3">
            {puzzle.logicFlow.map((step, index) => (
              <li
                key={`${step.cell}-${index}`}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-xs font-bold tracking-wider text-slate-500">
                    {index + 1}.
                  </span>
                  <span className="font-semibold text-white">
                    {step.cell} → {step.country}
                  </span>
                </div>
                <p className="mt-1 text-xs text-sky-200/90">{step.reason}</p>
                {step.cluesKnown.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-slate-800 pt-2">
                    {step.cluesKnown.map((clue) => (
                      <li key={clue} className="text-[0.68rem] leading-snug text-slate-400">
                        {clue}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <aside className="rounded-xl border border-slate-700 bg-slate-950 p-3">
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

function RowFragment({
  rowIndex,
  cols,
  puzzle,
  placed,
  selectedCell,
  wrongCell,
  revealed,
  onCellClick,
}: {
  rowIndex: number;
  cols: number;
  puzzle: Puzzle;
  placed: Record<string, string>;
  selectedCell: string | null;
  wrongCell: string | null;
  revealed: boolean;
  onCellClick: (key: string) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-center text-[0.65rem] font-bold text-slate-500">
        {rowIndex + 1}
      </div>
      {Array.from({ length: cols }).map((_, c) => {
        const key = cellKey(rowIndex, c);
        const iso = placed[key];
        const facts = puzzle.factsByCell[key] ?? [];
        const isSeed = key === puzzle.seedCell;
        const isPlaced = Boolean(iso);
        const isSelected = selectedCell === key;
        const isWrong = wrongCell === key;
        const showFacts = isPlaced || isSeed;

        let look: string;
        if (isWrong) {
          look = "border-red-500 bg-red-900/40";
        } else if (isSeed) {
          look = "border-amber-400/70 bg-amber-500/15";
        } else if (isPlaced) {
          look = revealed
            ? "border-slate-600 bg-slate-800/70"
            : "border-emerald-500/50 bg-emerald-900/30";
        } else if (isSelected) {
          look = "border-sky-400 bg-sky-900/40";
        } else {
          look = "border-slate-700 bg-slate-900 hover:border-sky-500";
        }

        return (
          <button
            type="button"
            key={key}
            onClick={() => onCellClick(key)}
            disabled={isPlaced}
            className={`relative min-h-[6rem] rounded-lg border p-1.5 text-left transition ${look} ${
              isPlaced ? "cursor-default" : "cursor-pointer"
            }`}
          >
            <span className="absolute top-1 right-1 text-[0.55rem] font-bold tracking-wider text-slate-500">
              {key}
            </span>
            {isSeed && (
              <span className="absolute top-1 left-1 rounded bg-amber-400 px-1 text-[0.5rem] font-bold tracking-wide text-amber-950">
                START
              </span>
            )}
            {isPlaced ? (
              <span className={`block text-sm font-semibold leading-tight text-white ${isSeed ? "mt-3.5" : "mt-3"}`}>
                {puzzle.countries[iso].name}
              </span>
            ) : (
              <span className="mt-3 block text-xs text-slate-600">
                {isSelected ? "typing..." : "tap to fill"}
              </span>
            )}
            {showFacts &&
              facts.map((fact) => (
                <span
                  key={fact.id}
                  className={`mt-1 block text-[0.62rem] leading-snug ${
                    fact.essential ? "text-slate-200" : "text-sky-300/80 italic"
                  }`}
                >
                  {fact.text}
                </span>
              ))}
          </button>
        );
      })}
    </>
  );
}
