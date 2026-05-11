/**
 * Squarified treemap layout (Bruls, Huijsen, van Wijk, 2000).
 * Produces a list of rectangles that fully tile the input rect with
 * areas proportional to each item's value and aspect ratios near 1.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export type ValuedItem = { value: number };

export type LayoutResult<T> = T & Rect;

type Scaled<T> = { item: T; area: number };

function worstAspect<T>(row: Scaled<T>[], shortEdge: number) {
  if (!row.length) {
    return Number.POSITIVE_INFINITY;
  }
  const sum = row.reduce((acc, entry) => acc + entry.area, 0);
  let maxArea = -Infinity;
  let minArea = Infinity;
  for (const entry of row) {
    if (entry.area > maxArea) maxArea = entry.area;
    if (entry.area < minArea) minArea = entry.area;
  }
  const s2 = shortEdge * shortEdge;
  if (sum <= 0 || minArea <= 0 || shortEdge <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max((s2 * maxArea) / (sum * sum), (sum * sum) / (s2 * minArea));
}

function placeRow<T>(
  row: Scaled<T>[],
  rect: Rect,
): { placed: LayoutResult<T>[]; remainder: Rect } {
  const rowArea = row.reduce((acc, entry) => acc + entry.area, 0);
  const placed: LayoutResult<T>[] = [];
  if (rowArea <= 0) {
    return { placed, remainder: rect };
  }

  if (rect.w >= rect.h) {
    const stripWidth = rowArea / rect.h;
    let y = rect.y;
    for (const entry of row) {
      const height = entry.area / stripWidth;
      placed.push({
        ...(entry.item as T),
        x: rect.x,
        y,
        w: stripWidth,
        h: height,
      });
      y += height;
    }
    return {
      placed,
      remainder: {
        x: rect.x + stripWidth,
        y: rect.y,
        w: Math.max(0, rect.w - stripWidth),
        h: rect.h,
      },
    };
  }

  const stripHeight = rowArea / rect.w;
  let x = rect.x;
  for (const entry of row) {
    const width = entry.area / stripHeight;
    placed.push({
      ...(entry.item as T),
      x,
      y: rect.y,
      w: width,
      h: stripHeight,
    });
    x += width;
  }
  return {
    placed,
    remainder: {
      x: rect.x,
      y: rect.y + stripHeight,
      w: rect.w,
      h: Math.max(0, rect.h - stripHeight),
    },
  };
}

export function squarify<T extends ValuedItem>(
  items: T[],
  rect: Rect,
): LayoutResult<T>[] {
  const filtered = items.filter((item) => item.value > 0);
  if (!filtered.length || rect.w <= 0 || rect.h <= 0) {
    return [];
  }

  const totalValue = filtered.reduce((acc, item) => acc + item.value, 0);
  const totalArea = rect.w * rect.h;
  if (totalValue <= 0 || totalArea <= 0) {
    return [];
  }
  const scale = totalArea / totalValue;
  const sorted = [...filtered].sort((a, b) => b.value - a.value);
  const queue: Scaled<T>[] = sorted.map((item) => ({
    item,
    area: item.value * scale,
  }));

  const placed: LayoutResult<T>[] = [];
  let currentRect = { ...rect };
  let row: Scaled<T>[] = [];
  let idx = 0;

  while (idx < queue.length) {
    const shortEdge = Math.min(currentRect.w, currentRect.h);
    if (shortEdge <= 0) {
      break;
    }
    const candidate = [...row, queue[idx]];
    const newAspect = worstAspect(candidate, shortEdge);
    const currentAspect = worstAspect(row, shortEdge);

    if (row.length === 0 || newAspect <= currentAspect) {
      row = candidate;
      idx += 1;
    } else {
      const { placed: rowPlaced, remainder } = placeRow(row, currentRect);
      placed.push(...rowPlaced);
      currentRect = remainder;
      row = [];
    }
  }

  if (row.length) {
    const { placed: rowPlaced } = placeRow(row, currentRect);
    placed.push(...rowPlaced);
  }

  return placed;
}
