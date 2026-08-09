import { useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

/** The accent a user can pick; the palette each one resolves to lives in App.css. */
export type AccentColor =
  | "blue"
  | "indigo"
  | "violet"
  | "magenta"
  | "orange"
  | "amber"
  | "green"
  | "teal"
  | "cyan"
  | "slate";

export const ACCENT_COLORS: AccentColor[] = [
  "blue",
  "indigo",
  "violet",
  "magenta",
  "orange",
  "amber",
  "green",
  "teal",
  "cyan",
  "slate",
];

const DEFAULT_ACCENT: AccentColor = "blue";

const STORAGE_KEY = "mixdb-theme";
const ACCENT_STORAGE_KEY = "mixdb-accent";

function readStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function readStoredAccent(): AccentColor {
  const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
  return ACCENT_COLORS.includes(stored as AccentColor) ? (stored as AccentColor) : DEFAULT_ACCENT;
}

function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
    localStorage.removeItem(STORAGE_KEY);
  } else {
    root.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }
}

/* The default is what `:root` already carries, so the attribute is left off for it rather than
   written out — same shape as the theme above, and it keeps the DOM clean for the common case. */
function applyAccent(accent: AccentColor): void {
  const root = document.documentElement;
  if (accent === DEFAULT_ACCENT) {
    root.removeAttribute("data-accent");
    localStorage.removeItem(ACCENT_STORAGE_KEY);
  } else {
    root.setAttribute("data-accent", accent);
    localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  }
}

/* Read before React mounts: the stored choice has to be on the root element for the very first
   paint, otherwise the window flashes the default accent on every launch. */
applyAccent(readStoredAccent());

export function useTheme(): [ThemeMode, (theme: ThemeMode) => void] {
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);

  function updateTheme(next: ThemeMode) {
    applyTheme(next);
    setTheme(next);
  }

  return [theme, updateTheme];
}

export function useAccent(): [AccentColor, (accent: AccentColor) => void] {
  const [accent, setAccent] = useState<AccentColor>(readStoredAccent);

  function updateAccent(next: AccentColor) {
    applyAccent(next);
    setAccent(next);
  }

  return [accent, updateAccent];
}
