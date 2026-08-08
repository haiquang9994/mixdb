import { useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "mixdb-theme";

function readStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
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

export function useTheme(): [ThemeMode, (theme: ThemeMode) => void] {
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);

  function updateTheme(next: ThemeMode) {
    applyTheme(next);
    setTheme(next);
  }

  return [theme, updateTheme];
}
