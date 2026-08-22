import { useEffect, useLayoutEffect, useState } from "react";
import GlassFilter from "./components/GlassFilter";
import SettingsModal from "./components/SettingsModal";
import UpdateToast from "./components/UpdateToast";
import ContextMenu from "../components/ContextMenu";
import { Tab, TabAction, TabStrip, TabTitle } from "../components/TabStrip";
import { PlusIcon, SettingsIcon } from "../icons";
import { isBlockedReload } from "../core/reload";
import { useScrollAcceleration } from "../core/scroll";
import { useShortcut, useShortcutDispatcher } from "../core/shortcuts";
import { useAccent, useGlass, useTheme } from "./theme";
import { useUpdateCheck } from "./update";
import { useTranslation } from "../i18n";
import type { TabBadge } from "./module";
import { rebadgeTab, retitleTab, tabIdAtOffset, type TabInfo } from "./tabs";
import { DEFAULT_MODULE_ID, MODULES, moduleById } from "./registry";
import { ALL_SHORTCUTS, MODULE_TAB_SHORTCUTS } from "./shortcuts";
import "./App.css";
/* After App.css, so the glass surfaces override the plain ones they replace rather than the other
   way round. */
import "./glass.css";

function App() {
  const { t } = useTranslation();

  function newTab(moduleId: string = DEFAULT_MODULE_ID): TabInfo {
    const def = moduleById(moduleId);
    return { id: crypto.randomUUID(), moduleId, title: t(def.defaultTitleKey), badges: [] };
  }

  const [tabs, setTabs] = useState<TabInfo[]>([newTab()]);
  const [activeId, setActiveId] = useState(tabs[0].id);
  const [theme, setTheme] = useTheme();
  const [accent, setAccent] = useAccent();
  const [glass, setGlass] = useGlass();
  const [settingsOpen, setSettingsOpen] = useState(false);
  /* Where the `[+]` menu was asked for, while it is open. Never set with one module: the button
     opens a tab outright then, exactly as it did before there was a registry. */
  const [moduleMenu, setModuleMenu] = useState<{ x: number; y: number } | null>(null);
  const update = useUpdateCheck();

  useScrollAcceleration();
  useShortcutDispatcher(ALL_SHORTCUTS);
  // Always listening — the tab bar is there on every screen the app has.
  useShortcut("app.newTab", () => openTab(), true);
  useShortcut("app.closeTab", () => closeTab(activeId), true);
  useShortcut("app.nextTab", () => setActiveId(tabIdAtOffset(tabs, activeId, 1)), true);
  useShortcut("app.prevTab", () => setActiveId(tabIdAtOffset(tabs, activeId, -1)), true);
  /* One number key per module — `Ctrl/Cmd+1` for the first in the registry, `2` for the second.
     Hooks in a loop, which is safe here and only here: `MODULE_TAB_SHORTCUTS` is a module-level
     constant, so the count and the order are fixed for the life of the app. Reading the list rather
     than naming the modules is what keeps this file from being the second place that knows them. */
  for (const { moduleId, def } of MODULE_TAB_SHORTCUTS) {
    useShortcut(def.id, () => openTab(moduleId), true);
  }

  function openTab(moduleId?: string) {
    const tab = newTab(moduleId);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      return next.length > 0 ? next : [newTab()];
    });
  }

  function renameTab(id: string, title: string) {
    setTabs((prev) => retitleTab(prev, id, title));
  }

  function setTabBadges(id: string, badges: TabBadge[]) {
    setTabs((prev) => rebadgeTab(prev, id, badges));
  }

  // Keeps activeId pointing at a real tab whenever the active one disappears
  // (e.g. closing the last remaining tab spawns a fresh one that must be focused).
  useLayoutEffect(() => {
    if (!tabs.some((t) => t.id === activeId)) {
      setActiveId(tabs[tabs.length - 1].id);
    }
  }, [tabs, activeId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Reloading the webview takes every open connection down with it, so no keystroke is left
      // able to ask for one. What `Ctrl+R` means instead is decided by the pane on screen, which
      // claims the key for its own reload button — see `useReloadShortcut`.
      //
      // The last chord not on the registry, and it is not a command: nothing is being asked for
      // here, only refused. See `isBlockedReload` for what differs between builds.
      if (isBlockedReload(e)) e.preventDefault();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <main className="app">
      {/* Draws nothing on its own — it is the filter the glass surfaces point at, and it has to
          outlive any one of them. Left out entirely while the setting is off, so a look nobody
          asked for costs nothing to have shipped. */}
      {glass && <GlassFilter />}
      <TabStrip>
        {/* The app's name is also its settings button, which nothing about a bare word at 70%
            opacity said — so it wears a surface, a border and a gear, and reads as something to
            press before it is hovered.

            Once an update is out, this is also the way back to it after the panel in the corner is
            gone, so it carries a dot until the user installs or skips that version. A download
            waved away mid-flight goes on, and finishes behind this dot. */}
        <button
          type="button"
          className={update.pending ? "brand brand-update" : "brand"}
          onClick={() => setSettingsOpen(true)}
          title={update.pending && update.release ? t("update.available", { version: update.release.version }) : t("app.settings")}
          aria-label={t("app.settings")}
        >
          MixDB
          <SettingsIcon className="brand-gear" size={14} />
        </button>
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            active={tab.id === activeId}
            className={tab.badges.map((b) => b.tabClassName).filter(Boolean).join(" ")}
            onClose={() => closeTab(tab.id)}
            closeLabel={t("app.closeTab")}
            onClick={() => setActiveId(tab.id)}
          >
            {/* Ahead of the name, where the eye lands first: a mark is there to be seen before a
                statement is typed, not after the connection has been identified. What each one
                means is the module's business — the shell only puts it where it goes. The tab is
                not a control with a name of its own, so the word travels with the mark for anyone
                who can't see it. */}
            {tab.badges.map((badge) => (
              <span
                key={badge.id}
                className={badge.className ? `tab-badge ${badge.className}` : "tab-badge"}
                title={badge.title}
              >
                {badge.icon}
                <span className="visually-hidden">{badge.label}</span>
              </span>
            ))}
            <TabTitle>{tab.title}</TabTitle>
          </Tab>
        ))}
        <TabAction
          onClick={(e) => {
            // One module and a menu would be a list of one, so the button just opens it — which is
            // what it did before there was a registry at all.
            if (MODULES.length < 2) {
              openTab();
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            setModuleMenu({ x: rect.left, y: rect.bottom });
          }}
          title={t("app.newConnectionTab")}
          aria-label={t("app.newConnectionTab")}
        >
          <PlusIcon />
        </TabAction>
      </TabStrip>

      {/* Unreachable while `MODULES` holds one entry, and here so that adding the second is a line
          in `registry.ts` rather than a tab bar to rewrite. Which also means it has never run: the
          module that lands beside `db` is the first thing that will exercise it. */}
      {moduleMenu && (
        <ContextMenu x={moduleMenu.x} y={moduleMenu.y} onClose={() => setModuleMenu(null)}>
          {MODULES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setModuleMenu(null);
                openTab(m.id);
              }}
            >
              <m.Icon size={14} />
              {t(m.labelKey)}
            </button>
          ))}
        </ContextMenu>
      )}

      <div className="tab-content">
        {tabs.map((tab) => {
          const { Tab } = moduleById(tab.moduleId);
          return (
            <div
              key={tab.id}
              className="tab-panel"
              style={{ display: tab.id === activeId ? "flex" : "none" }}
            >
              <Tab
                active={tab.id === activeId}
                onTitleChange={(title) => renameTab(tab.id, title)}
                onBadgesChange={(badges) => setTabBadges(tab.id, badges)}
              />
            </div>
          );
        })}
      </div>

      {settingsOpen && (
        <SettingsModal
          theme={theme}
          onThemeChange={setTheme}
          accent={accent}
          onAccentChange={setAccent}
          glass={glass}
          onGlassChange={setGlass}
          update={update}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Settings says the same thing in more detail, so the corner steps out of the way of it. */}
      {update.announcing && !settingsOpen && <UpdateToast update={update} />}
    </main>
  );
}

export default App;
