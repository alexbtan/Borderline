/** Deterministic seeded RNG so daily puzzles are reproducible. */

function hashString(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export type Rng = {
  /** Float in [0, 1). */
  next: () => number;
  /** Integer in [0, max). */
  int: (max: number) => number;
  /** Picks a random element. */
  pick: <T>(items: T[]) => T;
  /** Returns a shuffled copy (Fisher-Yates). */
  shuffle: <T>(items: T[]) => T[];
};

export function createRng(seed: string): Rng {
  let state = hashString(seed) || 1;
  const next = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(next() * max);
  const pick = <T>(items: T[]): T => items[int(items.length)];
  const shuffle = <T>(items: T[]): T[] => {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  return { next, int, pick, shuffle };
}
