export type HsSection = {
  id: number;
  short: string;
  label: string;
  color: string;
};

export const HS_SECTIONS: Record<number, HsSection> = {
  1: { id: 1, short: "Animal", label: "Animal Products", color: "#f4a698" },
  2: { id: 2, short: "Vege", label: "Vegetable Products", color: "#9bc77a" },
  3: { id: 3, short: "Fats", label: "Animal & Vegetable Fats", color: "#d9cf5f" },
  4: { id: 4, short: "Food", label: "Foodstuffs", color: "#f4a467" },
  5: { id: 5, short: "Mineral", label: "Mineral Products", color: "#a3503a" },
  6: { id: 6, short: "Chem", label: "Chemical Products", color: "#e0408a" },
  7: { id: 7, short: "Plast", label: "Plastics & Rubbers", color: "#a76dc2" },
  8: { id: 8, short: "Hide", label: "Animal Hides", color: "#d6a577" },
  9: { id: 9, short: "Wood", label: "Wood Products", color: "#a87655" },
  10: { id: 10, short: "Paper", label: "Paper Goods", color: "#cca988" },
  11: { id: 11, short: "Text", label: "Textiles", color: "#ec6ea0" },
  12: { id: 12, short: "Foot", label: "Footwear & Headwear", color: "#6e9bb6" },
  13: { id: 13, short: "Stone", label: "Stone & Glass", color: "#9aa6a3" },
  14: { id: 14, short: "Prec", label: "Precious Metals", color: "#e8d05a" },
  15: { id: 15, short: "Metals", label: "Metals", color: "#e9852e" },
  16: { id: 16, short: "Mach", label: "Machines", color: "#3da3dc" },
  17: { id: 17, short: "Trans", label: "Transportation", color: "#7ccaee" },
  18: { id: 18, short: "Inst", label: "Instruments", color: "#d44e9b" },
  19: { id: 19, short: "Arms", label: "Weapons", color: "#5c5c5c" },
  20: { id: 20, short: "Misc", label: "Miscellaneous", color: "#9d9d9d" },
  21: { id: 21, short: "Art", label: "Arts & Antiques", color: "#a89e89" },
};

export function getSectionId(code: string): number {
  const num = Number.parseInt(code, 10);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.floor(num / 100);
}

export function getSection(code: string): HsSection {
  const id = getSectionId(code);
  return HS_SECTIONS[id] ?? { id, short: "?", label: "Unknown", color: "#64748b" };
}
