import { useEffect, useLayoutEffect, useState } from "react";
import ConnectionTab from "./ConnectionTab";
import SettingsModal from "./components/SettingsModal";
import UpdateToast from "./components/UpdateToast";
import { CloseIcon, LockIcon, PlusIcon, SettingsIcon } from "./icons";
import { hasPrimaryModifier } from "./platform";
import { isBlockedReload } from "./reload";
import { useScrollAcceleration } from "./scroll";
import { isTextEntry } from "./textEntry";
import { useAccent, useTheme } from "./theme";
import { useUpdateCheck } from "./update";
import { useTranslation } from "./i18n";
import "./App.css";

interface TabInfo {
  id: string;
  title: string;
  /** Set while this tab holds a connection saved as read-only, so the tab bar can say so — the
   *  sidebar that carried the mark is gone once you are connected. */
  readOnly?: boolean;
}

function App() {
  const { t } = useTranslation();

  function newTab(): TabInfo {
    return { id: crypto.randomUUID(), title: t("app.newConnectionTitle") };
  }

  const [tabs, setTabs] = useState<TabInfo[]>([newTab()]);
  const [activeId, setActiveId] = useState(tabs[0].id);
  const [theme, setTheme] = useTheme();
  const [accent, setAccent] = useAccent();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const update = useUpdateCheck();

  useScrollAcceleration();

  function openTab() {
    const tab = newTab();
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
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  }

  function markTabReadOnly(id: string, readOnly: boolean) {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, readOnly: readOnly || undefined } : t)),
    );
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
      const shortcutKey = hasPrimaryModifier(e);
      if (shortcutKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        openTab();
      } else if (shortcutKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        closeTab(activeId);
      } else if (shortcutKey && e.key.toLowerCase() === "a" && !isTextEntry(e.target)) {
        // Outside a text field, select-all means "select the whole chrome of the app" — never
        // something the user wants. Views that have their own notion of "everything" (the SQL
        // grid selecting all of its rows) handle the key before it bubbles up to here.
        e.preventDefault();
      } else if (isBlockedReload(e)) {
        // Reloading the webview takes every open connection down with it, so no keystroke is left
        // able to ask for one. What `Ctrl+R` means instead is decided by the pane on screen, which
        // claims the key for its own reload button — see `useReloadShortcut`.
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeId]);

  return (
    <main className="app">
      <div className="tab-bar">
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
          <div
            key={tab.id}
            className={`${tab.id === activeId ? "tab tab-active" : "tab"}${
              tab.readOnly ? " tab-readonly" : ""
            }`}
            onClick={() => setActiveId(tab.id)}
          >
            {/* Ahead of the name, where the eye lands first: the point of it is to be seen before
                a statement is typed, not after the connection has been identified. The tab is not
                a control with a name of its own, so the word travels with the lock for anyone
                who can't see it. */}
            {tab.readOnly && (
              <span className="tab-lock" title={t("common.readOnlyConnection")}>
                <LockIcon size={12} />
                <span className="visually-hidden">{t("common.readOnly")}</span>
              </span>
            )}
            <span className="tab-title">{tab.title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              title={t("app.closeTab")}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
        <button className="tab-new" onClick={openTab} title={t("app.newConnectionTab")}>
          <PlusIcon />
        </button>
      </div>

      <div className="tab-content">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="tab-panel"
            style={{ display: tab.id === activeId ? "flex" : "none" }}
          >
            <ConnectionTab
              active={tab.id === activeId}
              onTitleChange={(title) => renameTab(tab.id, title)}
              onReadOnlyChange={(readOnly) => markTabReadOnly(tab.id, readOnly)}
            />
          </div>
        ))}
      </div>

      {settingsOpen && (
        <SettingsModal
          theme={theme}
          onThemeChange={setTheme}
          accent={accent}
          onAccentChange={setAccent}
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
