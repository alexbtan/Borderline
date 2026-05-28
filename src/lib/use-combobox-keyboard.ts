/* eslint-disable react-hooks/set-state-in-effect */
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

type UseComboboxKeyboardOptions = {
  suggestions: string[];
  value: string;
  setValue: (value: string) => void;
  disabled?: boolean;
  isExactMatch: (value: string) => boolean;
};

export function useComboboxKeyboard({
  suggestions,
  value,
  setValue,
  disabled = false,
  isExactMatch,
}: UseComboboxKeyboardOptions) {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    setHighlightedIndex(0);
    optionRefs.current = [];
  }, [suggestions]);

  useEffect(() => {
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, suggestions]);

  function setOptionRef(index: number, element: HTMLLIElement | null) {
    optionRefs.current[index] = element;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) {
      return;
    }

    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setHighlightedIndex((index) => (index + 1) % suggestions.length);
      return;
    }

    if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setHighlightedIndex(
        (index) => (index - 1 + suggestions.length) % suggestions.length,
      );
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (isExactMatch(trimmed)) {
      return;
    }

    const pick = suggestions[highlightedIndex] ?? suggestions[0];
    if (!pick) {
      return;
    }
    event.preventDefault();
    setValue(pick);
  }

  return {
    highlightedIndex,
    setHighlightedIndex,
    setOptionRef,
    handleKeyDown,
  };
}
