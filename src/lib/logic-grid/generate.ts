import rawData from "@/data/logic-grid-countries.json";

import { createRng, type Rng } from "./rng";
import type { CellKey, Clue, ClueKind, Continent, CountryMeta, LogicStep, Puzzle } from "./types";

const ALL = rawData as CountryMeta[];
const N = ALL.length;
const WORDS = Math.ceil(N / 32);

export const CONTINENTS: Continent[] = [
  "Asia",
  "Africa",
  "Europe",
  "North America",
  "South America",
  "Oceania",
];

export type Difficulty = "easy" | "medium" | "hard";

export function getDims(difficulty: Difficulty): { rows: number; cols: number } {
  switch (difficulty) {
    case "easy":
      return { rows: 4, cols: 3 };
    case "hard":
      return { rows: 5, cols: 5 };
    case "medium":
    default:
      return { rows: 5, cols: 4 };
  }
}

export function colLetter(col: number): string {
  return String.fromCharCode(65 + col);
}

export function cellKey(row: number, col: number): CellKey {
  return `${colLetter(col)}${row + 1}`;
}

type Pos = { row: number; col: number };

export function parseCell(key: CellKey): Pos {
  return { col: key.charCodeAt(0) - 65, row: Number(key.slice(1)) - 1 };
}

export function getAllCountryNames(): string[] {
  return ALL.map((c) => c.name).sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Indexed country facts + bitsets
// ---------------------------------------------------------------------------

type Index = {
  metas: CountryMeta[];
  idxOf: Map<string, number>;
  continentBits: Map<Continent, Bitset>;
  neighborBits: Bitset[];
  popRank: { rank: number; unique: boolean }[];
  areaRank: { rank: number; unique: boolean }[];
  capitalUnique: boolean[];
  islandBits: Bitset;
  twoWordBits: Bitset;
  letterBits: Map<string, Bitset>;
};

type Bitset = Uint32Array;

function bsNew(): Bitset {
  return new Uint32Array(WORDS);
}
function bsClone(a: Bitset): Bitset {
  return a.slice();
}
function bsSet(a: Bitset, i: number): void {
  a[i >>> 5] |= 1 << (i & 31);
}
function bsHas(a: Bitset, i: number): boolean {
  return (a[i >>> 5] & (1 << (i & 31))) !== 0;
}
function bsCount(a: Bitset): number {
  let n = 0;
  for (let w = 0; w < WORDS; w += 1) {
    let v = a[w];
    while (v) {
      v &= v - 1;
      n += 1;
    }
  }
  return n;
}
function bsAndInto(a: Bitset, b: Bitset): boolean {
  let changed = false;
  for (let w = 0; w < WORDS; w += 1) {
    const next = (a[w] & b[w]) >>> 0;
    if (next !== a[w]) {
      a[w] = next;
      changed = true;
    }
  }
  return changed;
}
function bsClearBitInto(a: Bitset[], cells: number[], bit: number): boolean {
  let changed = false;
  const w = bit >>> 5;
  const mask = ~(1 << (bit & 31));
  for (const c of cells) {
    const next = (a[c][w] & mask) >>> 0;
    if (next !== a[c][w]) {
      a[c][w] = next;
      changed = true;
    }
  }
  return changed;
}
function trailing(v: number): number {
  if (v === 0) return 32;
  let n = 0;
  while ((v & 1) === 0) {
    v >>>= 1;
    n += 1;
  }
  return n;
}
function bsForEach(a: Bitset, cb: (i: number) => void): void {
  for (let w = 0; w < WORDS; w += 1) {
    let v = a[w];
    while (v) {
      const bit = v & -v;
      const i = (w << 5) + trailing(bit);
      cb(i);
      v ^= bit;
    }
  }
}

let indexCache: Index | null = null;
function index(): Index {
  if (indexCache) {
    return indexCache;
  }
  const metas = ALL;
  const idxOf = new Map<string, number>();
  metas.forEach((m, i) => idxOf.set(m.iso3, i));

  const continentBits = new Map<Continent, Bitset>();
  const letterBits = new Map<string, Bitset>();
  const islandBits = bsNew();
  const twoWordBits = bsNew();
  for (const c of CONTINENTS) {
    continentBits.set(c, bsNew());
  }
  metas.forEach((m, i) => {
    bsSet(continentBits.get(m.continent)!, i);
    const lb = letterBits.get(m.firstLetter) ?? bsNew();
    bsSet(lb, i);
    letterBits.set(m.firstLetter, lb);
    if (m.borderCount === 0) bsSet(islandBits, i);
    if (m.nameWords === 2) bsSet(twoWordBits, i);
  });

  const neighborBits = metas.map((m) => {
    const b = bsNew();
    for (const n of m.borders) {
      const j = idxOf.get(n);
      if (j !== undefined) bsSet(b, j);
    }
    return b;
  });

  const popRank = rankWithin(metas, idxOf, continentBits, (m) => m.population);
  const areaRank = rankWithin(metas, idxOf, continentBits, (m) => m.area);

  const capCount = new Map<string, number>();
  for (const m of metas) {
    if (m.capital) capCount.set(m.capital, (capCount.get(m.capital) ?? 0) + 1);
  }
  const capitalUnique = metas.map(
    (m) => Boolean(m.capital) && capCount.get(m.capital!) === 1,
  );

  indexCache = {
    metas,
    idxOf,
    continentBits,
    neighborBits,
    popRank,
    areaRank,
    capitalUnique,
    islandBits,
    twoWordBits,
    letterBits,
  };
  return indexCache;
}

function rankWithin(
  metas: CountryMeta[],
  idxOf: Map<string, number>,
  continentBits: Map<Continent, Bitset>,
  value: (m: CountryMeta) => number,
): { rank: number; unique: boolean }[] {
  const out: { rank: number; unique: boolean }[] = metas.map(() => ({
    rank: 0,
    unique: false,
  }));
  for (const list of continentBits.values()) {
    const members: CountryMeta[] = [];
    bsForEach(list, (i) => members.push(metas[i]));
    members.sort((a, b) => value(b) - value(a));
    members.forEach((m, k) => {
      const i = idxOf.get(m.iso3)!;
      const prev = k > 0 ? value(members[k - 1]) : Infinity;
      const next = k < members.length - 1 ? value(members[k + 1]) : -Infinity;
      out[i] = { rank: k + 1, unique: value(m) !== prev && value(m) !== next };
    });
  }
  return out;
}

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

// ---------------------------------------------------------------------------
// Clues — each carries a sound prune over candidate bitsets
// ---------------------------------------------------------------------------

type State = Bitset[];

type GenClue = {
  id: string;
  kind: ClueKind;
  text: string;
  weight: number; // lower = keep (more elegant); higher = try to remove first
  cells: number[]; // cells whose candidates this clue can prune
  apply: (state: State) => boolean;
};

function cellIsClue(
  cellIdx: number,
  iso: number,
  kind: ClueKind,
  text: string,
  weight: number,
  id: string,
): GenClue {
  const only = bsNew();
  bsSet(only, iso);
  return {
    id,
    kind,
    text,
    weight,
    cells: [cellIdx],
    apply: (state) => bsAndInto(state[cellIdx], only),
  };
}

function maskClue(
  cellIdx: number,
  mask: Bitset,
  kind: ClueKind,
  text: string,
  weight: number,
  id: string,
): GenClue {
  return {
    id,
    kind,
    text,
    weight,
    cells: [cellIdx],
    apply: (state) => bsAndInto(state[cellIdx], mask),
  };
}

// ---------------------------------------------------------------------------
// Solution
// ---------------------------------------------------------------------------

type RowTheme = "top-pop" | "top-area" | "small-area";
type RowOrder = "population" | "area" | "lat" | "lon" | "alpha";

type SolutionData = {
  rows: number;
  cols: number;
  rowContinents: Continent[];
  solution: string[][];
  rowTheme: RowTheme[];
  rowOrder: RowOrder[];
  countries: Record<string, CountryMeta>;
};

function capLat(m: CountryMeta): number {
  return m.capitalLat;
}
function capLon(m: CountryMeta): number {
  return m.capitalLon;
}

function attrValue(m: CountryMeta, order: RowOrder): number | string {
  switch (order) {
    case "population":
      return m.population;
    case "area":
      return m.area;
    case "lat":
      return capLat(m);
    case "lon":
      return capLon(m);
    case "alpha":
      return m.name;
    default:
      return 0;
  }
}

function buildSolution(rng: Rng, rows: number, cols: number): SolutionData {
  const { continentBits, metas } = index();
  const eligible = CONTINENTS.filter((c) => bsCount(continentBits.get(c)!) >= cols + 3);
  const rowContinents = rng.shuffle(eligible).slice(0, rows);

  const solution: string[][] = [];
  const rowTheme: RowTheme[] = [];
  const rowOrder: RowOrder[] = [];
  const countries: Record<string, CountryMeta> = {};

  for (const continent of rowContinents) {
    const members: CountryMeta[] = [];
    bsForEach(continentBits.get(continent)!, (i) => members.push(metas[i]));

    const theme: RowTheme = rng.pick(["top-pop", "top-area", "top-pop", "small-area"]);
    let chosen: CountryMeta[];
    if (theme === "top-pop") {
      chosen = members.slice().sort((a, b) => b.population - a.population).slice(0, cols);
    } else if (theme === "top-area") {
      chosen = members.slice().sort((a, b) => b.area - a.area).slice(0, cols);
    } else {
      chosen = members.slice().sort((a, b) => a.area - b.area).slice(0, cols);
    }

    // Always arrange by some attribute, preferring one that differs from the
    // membership predicate so the set clue and the ordering clue interlock.
    const naturalOrder: RowOrder =
      theme === "top-pop" ? "population" : "area";
    const orderChoices: RowOrder[] = (["population", "area", "lat", "lon", "alpha"] as RowOrder[])
      .filter((o) => o !== naturalOrder);
    const order: RowOrder = rng.next() < 0.75 ? rng.pick(orderChoices) : naturalOrder;
    const dir = rng.next() < 0.5 ? 1 : -1;
    const arranged = chosen.slice().sort((a, b) => {
      const av = attrValue(a, order);
      const bv = attrValue(b, order);
      if (typeof av === "string" && typeof bv === "string") {
        return dir * av.localeCompare(bv);
      }
      return dir * ((av as number) - (bv as number));
    });

    solution.push(arranged.map((m) => m.iso3));
    rowTheme.push(theme);
    rowOrder.push(order);
    for (const m of arranged) countries[m.iso3] = m;
  }

  return { rows, cols, rowContinents, solution, rowTheme, rowOrder, countries };
}

// ---------------------------------------------------------------------------
// Clue pool (only true clues, derived from the solution)
// ---------------------------------------------------------------------------

function buildPool(data: SolutionData, rng: Rng): GenClue[] {
  const {
    metas,
    idxOf,
    continentBits,
    neighborBits,
    popRank,
    areaRank,
    islandBits,
    twoWordBits,
  } = index();
  const { rows, cols, solution, rowContinents, rowTheme, rowOrder } = data;

  const cellIndex = (r: number, c: number) => r * cols + c;
  const isoAt = (r: number, c: number) => solution[r][c];
  const iAt = (r: number, c: number) => idxOf.get(isoAt(r, c))!;
  const nameAt = (r: number, c: number) => metas[iAt(r, c)].name;
  const key = (r: number, c: number) => cellKey(r, c);

  const clues: GenClue[] = [];
  const used = new Set<string>();
  const push = (clue: GenClue) => {
    if (!used.has(clue.id)) {
      used.add(clue.id);
      clues.push(clue);
    }
  };

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const ci = cellIndex(r, c);
      const iso = iAt(r, c);
      const meta = metas[iso];
      const k = key(r, c);

      // anchor — only a safety net so the full pool is always solvable; the
      // minimizer drops these first so finished puzzles are anchor-free.
      push(cellIsClue(ci, iso, "anchor", `${k} is ${meta.name}.`, 20, `anchor-${k}`));

      // population rank — a single-cell identifier; removed early so the
      // elegant membership + ordering interlock survives instead.
      const pr = popRank[iso];
      if (pr.unique && pr.rank <= 8) {
        const phrase = pr.rank === 1 ? "most populous" : `${ordinal(pr.rank)} most populous`;
        push(
          cellIsClue(
            ci,
            iso,
            "populationRank",
            `${k} is the ${phrase} country in ${meta.continent}.`,
            12,
            `pop-${k}`,
          ),
        );
      }
      // area rank
      const ar = areaRank[iso];
      if (ar.unique && ar.rank <= 8) {
        const phrase = ar.rank === 1 ? "largest" : `${ordinal(ar.rank)} largest`;
        push(
          cellIsClue(
            ci,
            iso,
            "areaRank",
            `${k} is the ${phrase} country by area in ${meta.continent}.`,
            12,
            `area-${k}`,
          ),
        );
      }

      // continent of this cell
      push(
        maskClue(
          ci,
          continentBits.get(meta.continent)!,
          "continent",
          `${k} is in ${meta.continent}.`,
          6,
          `cont-${k}`,
        ),
      );

      // property: island
      if (meta.borderCount === 0) {
        push(maskClue(ci, islandBits, "property", `${k} has no land borders.`, 4, `island-${k}`));
      }
      // property: two-word
      if (meta.nameWords === 2) {
        push(maskClue(ci, twoWordBits, "property", `${k} has a two-word name.`, 4, `two-${k}`));
      }
    }
  }

  // Within-row superlatives (relational geography that pins one cell once the
  // row's membership is constrained).
  for (let r = 0; r < rows; r += 1) {
    const rowCells = Array.from({ length: cols }, (_, c) => cellIndex(r, c));
    let mostPop = 0;
    let leastPop = 0;
    let mostArea = 0;
    let north = 0;
    let south = 0;
    for (let c = 1; c < cols; c += 1) {
      if (metas[iAt(r, c)].population > metas[iAt(r, mostPop)].population) mostPop = c;
      if (metas[iAt(r, c)].population < metas[iAt(r, leastPop)].population) leastPop = c;
      if (metas[iAt(r, c)].area > metas[iAt(r, mostArea)].area) mostArea = c;
      if (capLat(metas[iAt(r, c)]) > capLat(metas[iAt(r, north)])) north = c;
      if (capLat(metas[iAt(r, c)]) < capLat(metas[iAt(r, south)])) south = c;
    }
    push(superlativeClue(cellIndex(r, mostPop), rowCells, (i) => metas[i].population, "max", `${key(r, mostPop)} is the most populous country in its row.`, `sup-pop-${r}`));
    push(superlativeClue(cellIndex(r, leastPop), rowCells, (i) => metas[i].population, "min", `${key(r, leastPop)} is the least populous country in its row.`, `sup-least-${r}`));
    push(superlativeClue(cellIndex(r, mostArea), rowCells, (i) => metas[i].area, "max", `${key(r, mostArea)} is the largest country by area in its row.`, `sup-area-${r}`));
    push(superlativeClue(cellIndex(r, north), rowCells, (i) => capLat(metas[i]), "max", `${key(r, north)} has the northernmost capital in its row.`, `sup-north-${r}`, "direction"));
    push(superlativeClue(cellIndex(r, south), rowCells, (i) => capLat(metas[i]), "min", `${key(r, south)} has the southernmost capital in its row.`, `sup-south-${r}`, "direction"));
  }

  // Relational compares between two cells (mix of within-row and cross-row so
  // some rows can be pinned via the other rows). Kept sparse to avoid a wall
  // of "more populous than" clues.
  const comparePairs: [number, number, number, number][] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c + 1 < cols; c += 1) comparePairs.push([r, c, r, c + 1]);
  }
  for (let r = 0; r + 1 < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) comparePairs.push([r, c, r + 1, c]);
  }
  for (const [r1, c1, r2, c2] of rng.shuffle(comparePairs)) {
    const i1 = iAt(r1, c1);
    const i2 = iAt(r2, c2);
    const hi = metas[i1].population > metas[i2].population ? [r1, c1, r2, c2] : [r2, c2, r1, c1];
    push(
      comparePopClue(
        cellIndex(hi[0], hi[1]),
        cellIndex(hi[2], hi[3]),
        `${cellKey(hi[0], hi[1])} is more populous than ${cellKey(hi[2], hi[3])}.`,
        `cmp-pop-${cellKey(hi[0], hi[1])}-${cellKey(hi[2], hi[3])}`,
      ),
    );
    const ha = metas[i1].area > metas[i2].area ? [r1, c1, r2, c2] : [r2, c2, r1, c1];
    push(
      compareAreaClue(
        cellIndex(ha[0], ha[1]),
        cellIndex(ha[2], ha[3]),
        `${cellKey(ha[0], ha[1])} is larger by area than ${cellKey(ha[2], ha[3])}.`,
        `cmp-area-${cellKey(ha[0], ha[1])}-${cellKey(ha[2], ha[3])}`,
      ),
    );
    // direction — compare capital latitudes (clearer than country centroids)
    const hn =
      capLat(metas[i1]) > capLat(metas[i2]) ? [r1, c1, r2, c2] : [r2, c2, r1, c1];
    push(
      compareLatClue(
        cellIndex(hn[0], hn[1]),
        cellIndex(hn[2], hn[3]),
        `${cellKey(hn[0], hn[1])}'s capital lies further north than ${cellKey(hn[2], hn[3])}'s capital.`,
        `cmp-lat-${cellKey(hn[0], hn[1])}-${cellKey(hn[2], hn[3])}`,
      ),
    );
  }

  // Border relations (any pair that actually shares a land border).
  for (let r1 = 0; r1 < rows; r1 += 1) {
    for (let c1 = 0; c1 < cols; c1 += 1) {
      for (let r2 = 0; r2 < rows; r2 += 1) {
        for (let c2 = 0; c2 < cols; c2 += 1) {
          if (r1 > r2 || (r1 === r2 && c1 >= c2)) continue;
          const i1 = iAt(r1, c1);
          const i2 = iAt(r2, c2);
          if (bsHas(neighborBits[i1], i2)) {
            push(
              borderClue(
                cellIndex(r1, c1),
                cellIndex(r2, c2),
                neighborBits,
                `${key(r1, c1)} shares a land border with ${key(r2, c2)}.`,
                `border-${key(r1, c1)}-${key(r2, c2)}`,
              ),
            );
          }
        }
      }
    }
  }

  // Ordering rule per row (every row is arranged by some attribute).
  for (let r = 0; r < rows; r += 1) {
    const order = rowOrder[r];
    const cellIdxs = Array.from({ length: cols }, (_, c) => cellIndex(r, c));
    const first = metas[iAt(r, 0)];
    const last = metas[iAt(r, cols - 1)];
    const ascending =
      order === "alpha"
        ? first.name.localeCompare(last.name) <= 0
        : orderValue(first, order) <= orderValue(last, order);
    push(orderingClue(cellIdxs, order, ascending, r, metas, idxOf));
  }

  // Membership defines a row's exact set (geographic knowledge of a continent).
  // Make ~1/3 of rows "dependent": they get no membership clue, so the solver
  // must pin them through cross-row relations + the distinct-continent rule.
  const dependentCount = Math.max(1, Math.round(rows * 0.35));
  const dependentRows = new Set(rng.shuffle(Array.from({ length: rows }, (_, i) => i)).slice(0, dependentCount));
  for (let r = 0; r < rows; r += 1) {
    if (dependentRows.has(r)) continue;
    const theme = rowTheme[r];
    const setBits = bsNew();
    for (let c = 0; c < cols; c += 1) bsSet(setBits, iAt(r, c));
    const cellIdxs = Array.from({ length: cols }, (_, c) => cellIndex(r, c));
    const label =
      theme === "top-pop"
        ? `the ${cols} most populous countries in ${rowContinents[r]}`
        : theme === "top-area"
          ? `the ${cols} largest countries by area in ${rowContinents[r]}`
          : `the ${cols} smallest countries by area in ${rowContinents[r]}`;
    push({
      id: `member-${r}`,
      kind: "membership",
      text: `One row contains exactly ${label}.`,
      weight: 2,
      cells: cellIdxs.slice(),
      apply: (state) => {
        let changed = false;
        for (const ci of cellIdxs) {
          if (bsAndInto(state[ci], setBits)) changed = true;
        }
        return changed;
      },
    });
  }

  // Counting clues (global cardinalities).
  pushCountingClues(data, push);

  // Negative clues — plausible traps not in the puzzle.
  const puzzleIsos = new Set<string>();
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) puzzleIsos.add(isoAt(r, c));
  const decoys = metas
    .filter((m) => rowContinents.includes(m.continent) && !puzzleIsos.has(m.iso3))
    .sort((a, b) => b.population - a.population)
    .slice(0, 24);
  for (const decoy of rng.shuffle(decoys).slice(0, 8)) {
    const di = idxOf.get(decoy.iso3)!;
    push(negativeClue(di, rows * cols, `${decoy.name} is not in this puzzle.`, `neg-${decoy.iso3}`));
  }

  return clues;
}

function orderValue(m: CountryMeta, order: RowOrder): number {
  switch (order) {
    case "population":
      return m.population;
    case "area":
      return m.area;
    case "lat":
      return capLat(m);
    case "lon":
      return capLon(m);
    case "alpha":
      return 0;
    default:
      return 0;
  }
}

function comparePopClue(a: number, b: number, text: string, id: string): GenClue {
  const { metas } = index();
  return {
    id,
    kind: "compare",
    text,
    weight: 3,
    cells: [a, b],
    apply: (state) => boundsCompare(state, a, b, (i) => metas[i].population),
  };
}
function compareAreaClue(a: number, b: number, text: string, id: string): GenClue {
  const { metas } = index();
  return {
    id,
    kind: "compare",
    text,
    weight: 4,
    cells: [a, b],
    apply: (state) => boundsCompare(state, a, b, (i) => metas[i].area),
  };
}
function compareLatClue(a: number, b: number, text: string, id: string): GenClue {
  const { metas } = index();
  return {
    id,
    kind: "direction",
    text,
    weight: 3,
    cells: [a, b],
    apply: (state) => boundsCompare(state, a, b, (i) => capLat(metas[i])),
  };
}

/** a's value strictly greater than b's value. */
function boundsCompare(
  state: State,
  a: number,
  b: number,
  value: (i: number) => number,
): boolean {
  if (bsCount(state[a]) === 1 && bsCount(state[b]) === 1) return false;
  let minB = Infinity;
  let maxA = -Infinity;
  bsForEach(state[b], (i) => {
    minB = Math.min(minB, value(i));
  });
  bsForEach(state[a], (i) => {
    maxA = Math.max(maxA, value(i));
  });
  let changed = false;
  bsForEach(state[a], (i) => {
    if (value(i) <= minB) {
      state[a][i >>> 5] &= ~(1 << (i & 31));
      changed = true;
    }
  });
  bsForEach(state[b], (i) => {
    if (value(i) >= maxA) {
      state[b][i >>> 5] &= ~(1 << (i & 31));
      changed = true;
    }
  });
  return changed;
}

/** `target` holds the strict max (or min) value in `rowCells`. */
function superlativeClue(
  target: number,
  rowCells: number[],
  value: (i: number) => number,
  mode: "max" | "min",
  text: string,
  id: string,
  kind: ClueKind = "compare",
): GenClue {
  const others = rowCells.filter((c) => c !== target);
  return {
    id,
    kind,
    text,
    weight: 5,
    cells: rowCells.slice(),
    apply: (state) => {
      let changed = false;
      const minOf = (cell: number) => {
        let m = Infinity;
        bsForEach(state[cell], (i) => (m = Math.min(m, value(i))));
        return m;
      };
      const maxOf = (cell: number) => {
        let m = -Infinity;
        bsForEach(state[cell], (i) => (m = Math.max(m, value(i))));
        return m;
      };
      if (mode === "max") {
        // target must exceed every other cell's value
        let bound = -Infinity;
        for (const o of others) bound = Math.max(bound, minOf(o));
        bsForEach(state[target], (i) => {
          if (value(i) <= bound) {
            state[target][i >>> 5] &= ~(1 << (i & 31));
            changed = true;
          }
        });
        const tMax = maxOf(target);
        for (const o of others) {
          bsForEach(state[o], (i) => {
            if (value(i) >= tMax) {
              state[o][i >>> 5] &= ~(1 << (i & 31));
              changed = true;
            }
          });
        }
      } else {
        let bound = Infinity;
        for (const o of others) bound = Math.min(bound, maxOf(o));
        bsForEach(state[target], (i) => {
          if (value(i) >= bound) {
            state[target][i >>> 5] &= ~(1 << (i & 31));
            changed = true;
          }
        });
        const tMin = minOf(target);
        for (const o of others) {
          bsForEach(state[o], (i) => {
            if (value(i) <= tMin) {
              state[o][i >>> 5] &= ~(1 << (i & 31));
              changed = true;
            }
          });
        }
      }
      return changed;
    },
  };
}

function borderClue(
  a: number,
  b: number,
  neighborBits: Bitset[],
  text: string,
  id: string,
): GenClue {
  return {
    id,
    kind: "border",
    text,
    weight: 3,
    cells: [a, b],
    apply: (state) => {
      if (bsCount(state[a]) === 1 && bsCount(state[b]) === 1) return false;
      const allowedA = bsNew();
      bsForEach(state[b], (i) => {
        for (let w = 0; w < WORDS; w += 1) allowedA[w] |= neighborBits[i][w];
      });
      const allowedB = bsNew();
      bsForEach(state[a], (i) => {
        for (let w = 0; w < WORDS; w += 1) allowedB[w] |= neighborBits[i][w];
      });
      let changed = bsAndInto(state[a], allowedA);
      if (bsAndInto(state[b], allowedB)) changed = true;
      return changed;
    },
  };
}

function orderingClue(
  cellIdxs: number[],
  order: RowOrder,
  ascending: boolean,
  rowIndex: number,
  metas: CountryMeta[],
  idxOf: Map<string, number>,
): GenClue {
  const orderName: Record<string, string> = {
    population: "population",
    area: "area",
    lat: "capital latitude (north to south)",
    lon: "capital longitude (west to east)",
    alpha: "alphabetical order",
  };
  void idxOf;
  const text =
    order === "alpha"
      ? `One row's countries are in alphabetical order from left to right.`
      : `One row's countries run left to right by ${orderName[order!]}.`;
  return {
    id: `order-${rowIndex}`,
    kind: "ordering",
    text,
    weight: 2,
    cells: cellIdxs.slice(),
    apply: (state) => {
      let allSingle = true;
      for (const ci of cellIdxs) {
        if (bsCount(state[ci]) !== 1) {
          allSingle = false;
          break;
        }
      }
      if (allSingle) return false;
      const valOf = (i: number) =>
        order === "alpha" ? metas[i].name : orderValue(metas[i], order);
      let changed = false;
      // bounds consistency over adjacent positions
      for (let p = 0; p < cellIdxs.length - 1; p += 1) {
        const lo = cellIdxs[ascending ? p : p + 1];
        const hi = cellIdxs[ascending ? p + 1 : p];
        // lo's value must be < hi's value
        let minHi: number | string = Infinity;
        let maxLo: number | string = -Infinity;
        bsForEach(state[hi], (i) => {
          const v = valOf(i);
          if (cmp(v, minHi) < 0) minHi = v;
        });
        bsForEach(state[lo], (i) => {
          const v = valOf(i);
          if (cmp(v, maxLo) > 0) maxLo = v;
        });
        bsForEach(state[lo], (i) => {
          if (cmp(valOf(i), minHi) >= 0) {
            state[lo][i >>> 5] &= ~(1 << (i & 31));
            changed = true;
          }
        });
        bsForEach(state[hi], (i) => {
          if (cmp(valOf(i), maxLo) <= 0) {
            state[hi][i >>> 5] &= ~(1 << (i & 31));
            changed = true;
          }
        });
      }
      return changed;
    },
  };
}

function cmp(a: number | string, b: number | string): number {
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  if (a === Infinity) return 1;
  if (a === -Infinity) return -1;
  if (b === Infinity) return -1;
  if (b === -Infinity) return 1;
  return (a as number) - (b as number);
}

function negativeClue(iso: number, cellCount: number, text: string, id: string): GenClue {
  const allCells = Array.from({ length: cellCount }, (_, i) => i);
  return {
    id,
    kind: "notInQuiz",
    text,
    weight: 4,
    cells: allCells,
    apply: (state) => bsClearBitInto(state, allCells, iso),
  };
}

function pushCountingClues(data: SolutionData, push: (c: GenClue) => void): void {
  const { metas, idxOf, islandBits, twoWordBits } = index();
  const { rows, cols, solution } = data;
  const cellCount = rows * cols;
  const all = (i: number) => i;
  void all;

  const isoList: number[] = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) isoList.push(idxOf.get(solution[r][c])!);

  const islandCount = isoList.filter((i) => metas[i].borderCount === 0).length;
  if (islandCount > 0) {
    push(cardinalityClue(islandBits, islandCount, cellCount, `Exactly ${islandCount} ${islandCount === 1 ? "country has" : "countries have"} no land borders.`, `cnt-island`));
  }
  const twoWordCount = isoList.filter((i) => metas[i].nameWords === 2).length;
  if (twoWordCount > 0) {
    push(cardinalityClue(twoWordBits, twoWordCount, cellCount, `Exactly ${twoWordCount} ${twoWordCount === 1 ? "country has" : "countries have"} a two-word name.`, `cnt-two`));
  }
}

/** Sound cardinality: exactly `n` cells take a value in `mask`. */
function cardinalityClue(
  mask: Bitset,
  n: number,
  cellCount: number,
  text: string,
  id: string,
): GenClue {
  const notMask = mask.slice();
  for (let w = 0; w < WORDS; w += 1) notMask[w] = ~notMask[w];
  const allCells = Array.from({ length: cellCount }, (_, i) => i);
  return {
    id,
    kind: "count",
    text,
    weight: 4,
    cells: allCells,
    apply: (state) => {
      let mustYes = 0;
      let canYes = 0;
      const optional: number[] = [];
      for (let ci = 0; ci < cellCount; ci += 1) {
        const total = bsCount(state[ci]);
        let inMask = 0;
        bsForEach(state[ci], (i) => {
          if (bsHas(mask, i)) inMask += 1;
        });
        if (inMask === 0) continue; // forced NO
        if (inMask === total) {
          mustYes += 1; // forced YES
        } else {
          canYes += 1;
          optional.push(ci);
        }
      }
      let changed = false;
      if (mustYes === n) {
        // optionals must be NO -> intersect with notMask
        for (const ci of optional) {
          if (bsAndInto(state[ci], notMask)) changed = true;
        }
      } else if (mustYes + canYes === n) {
        // every optional must be YES -> intersect with mask
        for (const ci of optional) {
          if (bsAndInto(state[ci], mask)) changed = true;
        }
      }
      return changed;
    },
  };
}

// ---------------------------------------------------------------------------
// Propagator (no-guess)
// ---------------------------------------------------------------------------

function freshState(rows: number, cols: number): State {
  const universe = bsNew();
  for (let i = 0; i < N; i += 1) bsSet(universe, i);
  return Array.from({ length: rows * cols }, () => universe.slice());
}

function bsFirstIndex(a: Bitset): number {
  for (let w = 0; w < WORDS; w += 1) {
    if (a[w]) return (w << 5) + trailing(a[w]);
  }
  return -1;
}

type Touch = (cell: number) => void;

/** Structural backbone: rows are a single, distinct continent each. */
function backbone(state: State, rows: number, cols: number, touch: Touch): void {
  const { continentBits } = index();
  const rowFeasible: Set<Continent>[] = [];
  for (let r = 0; r < rows; r += 1) {
    const feasible = new Set<Continent>();
    for (const cont of CONTINENTS) {
      const bits = continentBits.get(cont)!;
      let okForAll = true;
      for (let c = 0; c < cols; c += 1) {
        const cell = state[r * cols + c];
        let any = false;
        for (let w = 0; w < WORDS; w += 1) {
          if (cell[w] & bits[w]) {
            any = true;
            break;
          }
        }
        if (!any) {
          okForAll = false;
          break;
        }
      }
      if (okForAll) feasible.add(cont);
    }
    rowFeasible.push(feasible);
  }

  for (let r = 0; r < rows; r += 1) {
    if (rowFeasible[r].size === 1) {
      const [cont] = rowFeasible[r];
      for (let r2 = 0; r2 < rows; r2 += 1) {
        if (r2 !== r) rowFeasible[r2].delete(cont);
      }
    }
  }

  for (let r = 0; r < rows; r += 1) {
    const allow = bsNew();
    for (const cont of rowFeasible[r]) {
      const bits = continentBits.get(cont)!;
      for (let w = 0; w < WORDS; w += 1) allow[w] |= bits[w];
    }
    for (let c = 0; c < cols; c += 1) {
      const ci = r * cols + c;
      if (bsAndInto(state[ci], allow)) touch(ci);
    }
  }
}

/** All-different: a solved cell removes its country from every other cell. */
function allDifferent(state: State, touch: Touch): void {
  for (let ci = 0; ci < state.length; ci += 1) {
    if (bsCount(state[ci]) === 1) {
      const only = bsFirstIndex(state[ci]);
      const w = only >>> 5;
      const mask = 1 << (only & 31);
      for (let cj = 0; cj < state.length; cj += 1) {
        if (cj !== ci && state[cj][w] & mask) {
          state[cj][w] &= ~mask;
          touch(cj);
        }
      }
    }
  }
}

/**
 * No-guess constraint propagation via a worklist: a clue is only (re)applied
 * when one of the cells it constrains has changed. Returns false on
 * contradiction (an empty cell).
 */
function propagate(state: State, active: GenClue[], rows: number, cols: number): boolean {
  const cellToClues: GenClue[][] = Array.from({ length: rows * cols }, () => []);
  for (const clue of active) {
    for (const cell of clue.cells) cellToClues[cell].push(clue);
  }

  // Strong, cell-collapsing clues first so weak clues don't churn over
  // full candidate sets before anchors/identifiers fire.
  const queue: GenClue[] = active.slice().sort((a, b) => b.weight - a.weight);
  const inQueue = new Set<GenClue>(active);
  let head = 0;
  let structuralDirty = true;

  const touch: Touch = (cell) => {
    structuralDirty = true;
    for (const clue of cellToClues[cell]) {
      if (!inQueue.has(clue)) {
        inQueue.add(clue);
        queue.push(clue);
      }
    }
  };

  let guard = 0;
  // Propagation is monotonic (bits are only ever removed), so it always
  // terminates; this cap is just a safety net against logic regressions.
  const maxSteps = 200000 + active.length * rows * cols * 80;
  while (structuralDirty || head < queue.length) {
    guard += 1;
    if (guard > maxSteps) break;
    if (structuralDirty) {
      structuralDirty = false;
      backbone(state, rows, cols, touch);
      allDifferent(state, touch);
      continue;
    }
    const clue = queue[head];
    head += 1;
    inQueue.delete(clue);
    if (clue.apply(state)) {
      for (const cell of clue.cells) touch(cell);
    }
  }

  for (const cell of state) {
    if (bsCount(cell) === 0) return false;
  }
  return true;
}

function isSolved(state: State): boolean {
  return state.every((cell) => bsCount(cell) === 1);
}

function matchesSolution(state: State, data: SolutionData): boolean {
  const { idxOf } = index();
  const { cols, solution } = data;
  for (let i = 0; i < state.length; i += 1) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    if (bsCount(state[i]) !== 1) return false;
    if (bsFirstIndex(state[i]) !== idxOf.get(solution[r][c])!) return false;
  }
  return true;
}

function solvesUniquely(active: GenClue[], data: SolutionData): boolean {
  const state = freshState(data.rows, data.cols);
  if (!propagate(state, active, data.rows, data.cols)) return false;
  return isSolved(state) && matchesSolution(state, data);
}

// ---------------------------------------------------------------------------
// Minimization with diversity bias
// ---------------------------------------------------------------------------

function minimize(pool: GenClue[], data: SolutionData, rng: Rng): GenClue[] {
  if (!solvesUniquely(pool, data)) {
    return pool; // shouldn't happen — anchors guarantee solvability
  }
  let active = pool.slice();
  let removedSomething = true;
  while (removedSomething) {
    removedSomething = false;
    // Attempt removals in order of weight desc (drop single-cell identifiers
    // first), with random tie-break, so relational/membership/ordering clues
    // survive and the puzzle is non-linear.
    const order = active
      .map((clue) => ({ clue, key: clue.weight + rng.next() }))
      .sort((a, b) => b.key - a.key)
      .map((x) => x.clue);
    for (const clue of order) {
      if (!active.includes(clue)) continue;
      const trial = active.filter((c) => c !== clue);
      if (solvesUniquely(trial, data)) {
        active = trial;
        removedSomething = true;
      }
    }
  }
  return active;
}

// ---------------------------------------------------------------------------
// Progressive-reveal scheduler
// ---------------------------------------------------------------------------

const MAX_FACTS_PER_CELL = 3;

function collectKnownClues(factsByCell: Record<CellKey, Clue[]>, solvedKeys: CellKey[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of solvedKeys) {
    for (const fact of factsByCell[key] ?? []) {
      if (!seen.has(fact.text)) {
        seen.add(fact.text);
        out.push(fact.text);
      }
    }
  }
  return out;
}

function schedule(
  clues: GenClue[],
  data: SolutionData,
  rng: Rng,
): {
  seedCell: CellKey;
  factsByCell: Record<CellKey, Clue[]>;
  solveOrder: CellKey[];
  logicFlow: LogicStep[];
} {
  const { rows, cols } = data;
  const { metas, idxOf } = index();
  const cellKeys: CellKey[] = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) cellKeys.push(cellKey(r, c));

  const seedCell = rng.pick(cellKeys);
  const seedPos = parseCell(seedCell);
  const seedIdx = seedPos.row * cols + seedPos.col;

  const factsByCell: Record<CellKey, Clue[]> = {};
  for (const k of cellKeys) factsByCell[k] = [];

  const logicFlow: LogicStep[] = [];

  const state = freshState(rows, cols);
  // pin the seed
  const seedIso = idxOf.get(data.solution[seedPos.row][seedPos.col])!;
  const only = bsNew();
  bsSet(only, seedIso);
  bsAndInto(state[seedIdx], only);
  propagate(state, [], rows, cols);

  const solvedOrder: CellKey[] = cellKeys.filter((k) => {
    const p = parseCell(k);
    return bsCount(state[p.row * cols + p.col]) === 1;
  });
  const hostStack = solvedOrder.slice();
  const active: GenClue[] = [];
  const remaining = clues.slice();

  logicFlow.push({
    cell: seedCell,
    country: metas[seedIso].name,
    reason: "Given starting country.",
    cluesKnown: [],
  });

  const newlySolvedKeys = (): CellKey[] =>
    cellKeys.filter((k) => {
      const p = parseCell(k);
      return bsCount(state[p.row * cols + p.col]) === 1 && !solvedOrder.includes(k);
    });

  const hostOn = (clue: GenClue) => {
    // most-recently solved cell with capacity, else seed, else any
    for (let i = hostStack.length - 1; i >= 0; i -= 1) {
      if (factsByCell[hostStack[i]].length < MAX_FACTS_PER_CELL) {
        factsByCell[hostStack[i]].push(toClue(clue));
        return;
      }
    }
    factsByCell[seedCell].push(toClue(clue));
  };

  let guard = 0;
  while (solvedOrder.length < cellKeys.length && guard < 2000) {
    guard += 1;
    // find a single remaining clue that produces a new singleton
    let progress: GenClue | null = null;
    for (const clue of remaining) {
      const trial = cloneState(state);
      propagate(trial, [...active, clue], rows, cols);
      const solvedNow = cellKeys.filter((k) => {
        const p = parseCell(k);
        return bsCount(trial[p.row * cols + p.col]) === 1;
      }).length;
      if (solvedNow > solvedOrder.length) {
        progress = clue;
        break;
      }
    }
    if (!progress) {
      // add the clue that prunes the most (dormant reveal), else stop
      let best: GenClue | null = null;
      let bestReduction = 0;
      for (const clue of remaining) {
        const trial = cloneState(state);
        propagate(trial, [...active, clue], rows, cols);
        const reduction = totalCandidates(state) - totalCandidates(trial);
        if (reduction > bestReduction) {
          bestReduction = reduction;
          best = clue;
        }
      }
      // Fall back to revealing the next clue dormantly so the reveal always
      // makes its way to a complete solution (the minimal set solves alone).
      progress = best ?? (remaining.length > 0 ? remaining[0] : null);
    }
    if (!progress) break;

    hostOn(progress);
    active.push(progress);
    remaining.splice(remaining.indexOf(progress), 1);
    propagate(state, active, rows, cols);
    for (const k of newlySolvedKeys()) {
      solvedOrder.push(k);
      hostStack.push(k);
      const pos = parseCell(k);
      const iso = idxOf.get(data.solution[pos.row][pos.col])!;
      logicFlow.push({
        cell: k,
        country: metas[iso].name,
        reason: `New clue revealed: “${progress.text}”`,
        cluesKnown: collectKnownClues(factsByCell, solvedOrder),
      });
    }
  }

  return { seedCell, factsByCell, solveOrder: solvedOrder, logicFlow };
}

function cloneState(state: State): State {
  return state.map((b) => b.slice());
}
function totalCandidates(state: State): number {
  let n = 0;
  for (const cell of state) n += bsCount(cell);
  return n;
}
function toClue(gen: GenClue): Clue {
  const essential = gen.kind !== "count" && gen.kind !== "notInQuiz" ? true : false;
  return { id: gen.id, kind: gen.kind, text: gen.text, essential };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type GenStats = {
  attempts: number;
  poolSize: number;
  minimalSize: number;
  scheduledSolved: number;
  total: number;
  kinds: Record<string, number>;
  timeMs: number;
};

function generateInternal(
  seed: string,
  difficulty: Difficulty,
): { puzzle: Puzzle; stats: GenStats } {
  const started = Date.now();
  const rng = createRng(seed);
  const { rows, cols } = getDims(difficulty);

  const total = rows * cols;
  let best:
    | {
        data: SolutionData;
        pool: GenClue[];
        minimal: GenClue[];
        seedCell: CellKey;
        factsByCell: Record<CellKey, Clue[]>;
        solveOrder: CellKey[];
        logicFlow: LogicStep[];
        attempts: number;
      }
    | null = null;

  // Retry whole generation (with a salted RNG) until the progressive reveal
  // fully solves the grid; keep the best attempt as a fallback.
  for (let salt = 0; salt < 8; salt += 1) {
    const r = salt === 0 ? rng : createRng(`${seed}#${salt}`);
    let data = buildSolution(r, rows, cols);
    let pool = buildPool(data, r);
    let attempts = 0;
    while (!solvesUniquely(pool, data) && attempts < 20) {
      data = buildSolution(r, rows, cols);
      pool = buildPool(data, r);
      attempts += 1;
    }
    const minimal = minimize(pool, data, r);
    const sched = schedule(minimal, data, r);
    const candidate = { data, pool, minimal, ...sched, attempts };
    if (!best || sched.solveOrder.length > best.solveOrder.length) best = candidate;
    if (sched.solveOrder.length === total) break;
  }

  const { data, pool, minimal, seedCell, factsByCell, solveOrder, logicFlow, attempts } = best!;

  const fullOrder = solveOrder.slice();
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const k = cellKey(r, c);
      if (!fullOrder.includes(k)) fullOrder.push(k);
    }
  }

  const kinds: Record<string, number> = {};
  for (const facts of Object.values(factsByCell)) {
    for (const fact of facts) kinds[fact.kind] = (kinds[fact.kind] ?? 0) + 1;
  }

  const puzzle: Puzzle = {
    rows,
    cols,
    rowContinents: data.rowContinents,
    solution: data.solution,
    countries: data.countries,
    seedCell,
    factsByCell,
    solveOrder: fullOrder,
    logicFlow,
  };
  const stats: GenStats = {
    attempts,
    poolSize: pool.length,
    minimalSize: minimal.length,
    scheduledSolved: solveOrder.length,
    total,
    kinds,
    timeMs: Date.now() - started,
  };
  return { puzzle, stats };
}

export function generatePuzzle(seed: string, difficulty: Difficulty = "medium"): Puzzle {
  return generateInternal(seed, difficulty).puzzle;
}

export function generatePuzzleWithStats(
  seed: string,
  difficulty: Difficulty = "medium",
): { puzzle: Puzzle; stats: GenStats } {
  return generateInternal(seed, difficulty);
}
