export type Continent =
  | "Asia"
  | "Africa"
  | "Europe"
  | "North America"
  | "South America"
  | "Oceania";

export type CountryMeta = {
  iso3: string;
  name: string;
  continent: Continent;
  population: number;
  capital: string | null;
  area: number;
  subregion: string | null;
  borders: string[];
  borderCount: number;
  nameWords: number;
  nameLetters: number;
  firstLetter: string;
  lat: number;
  lon: number;
  /** Capital-city latitude (used for north/south clues). */
  capitalLat: number;
  /** Capital-city longitude (used for east/west ordering clues). */
  capitalLon: number;
};

export type LogicStep = {
  cell: CellKey;
  country: string;
  /** Why this cell is placed at this point in the chain. */
  reason: string;
  /** Every clue visible once this cell is filled in. */
  cluesKnown: string[];
};

/** Cell key in the form column-letter + 1-indexed row, e.g. "A1", "C4". */
export type CellKey = string;

export type ClueKind =
  | "anchor"
  | "capital"
  | "populationRank"
  | "areaRank"
  | "continent"
  | "property"
  | "compare"
  | "direction"
  | "border"
  | "ordering"
  | "membership"
  | "count"
  | "notInQuiz";

export type Clue = {
  id: string;
  kind: ClueKind;
  text: string;
  /** True when this clue is part of the guaranteed deduction chain. */
  essential: boolean;
};

export type Puzzle = {
  rows: number;
  cols: number;
  /** Continent for each row, top to bottom (hidden from the player). */
  rowContinents: Continent[];
  /** Solution iso3 codes indexed as solution[row][col]. */
  solution: string[][];
  /** Metadata for every country used in the grid. */
  countries: Record<string, CountryMeta>;
  /** The pre-filled starting cell. */
  seedCell: CellKey;
  /** Facts revealed when each cell is solved (may be empty for some cells). */
  factsByCell: Record<CellKey, Clue[]>;
  /** Cells in the intended deduction order (used for hints). */
  solveOrder: CellKey[];
  /** Step-by-step logic chain shown after completion. */
  logicFlow: LogicStep[];
};
