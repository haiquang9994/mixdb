import type { TabBadge } from "./module";

/**
 * What the tab bar knows about one open tab, and the two ways a module changes it.
 *
 * Both updaters hand back **the array they were given** when the change is no change. That is not
 * an optimisation: a module reports its title from an effect, the shell passes a fresh callback on
 * every render, and a `setTabs` that always allocates turns the pair into a render loop that
 * React stops with "Maximum update depth exceeded". Bailing out here breaks the loop for every
 * module, including the ones not written yet.
 */
export interface TabInfo {
  id: string;
  /** Which module's workspace this tab holds. Looked up in the registry to render it. */
  moduleId: string;
  title: string;
  /** What the module asked the tab bar to show for it. Reported rather than worked out up here:
   *  only the module knows what its own state means — see {@link TabBadge}. */
  badges: TabBadge[];
}

export function retitleTab(tabs: TabInfo[], id: string, title: string): TabInfo[] {
  const tab = tabs.find((t) => t.id === id);
  if (tab === undefined || tab.title === title) return tabs;
  return tabs.map((t) => (t === tab ? { ...t, title } : t));
}

/** Compared by identity, not contents: a badge holds a React element, which nothing can compare
 *  by value, and every module builds its list with `useMemo` for exactly this reason. */
export function rebadgeTab(tabs: TabInfo[], id: string, badges: TabBadge[]): TabInfo[] {
  const tab = tabs.find((t) => t.id === id);
  if (tab === undefined || tab.badges === badges) return tabs;
  return tabs.map((t) => (t === tab ? { ...t, badges } : t));
}
