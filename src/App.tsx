import { useEffect, useLayoutEffect, useState } from "react";
import ConnectionTab from "./ConnectionTab";
import SettingsModal from "./components/SettingsModal";
import { CloseIcon, PlusIcon } from "./icons";
import { useAccent, useTheme } from "./theme";
import { useTranslation } from "./i18n";
import "./App.css";

interface TabInfo {
  id: string;
  title: string;
}

/** Whether a keyboard event landed somewhere the user is typing, where the browser's own
 *  editing shortcuts have to keep working. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
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

  // Keeps activeId pointing at a real tab whenever the active one disappears
  // (e.g. closing the last remaining tab spawns a fresh one that must be focused).
  useLayoutEffect(() => {
    if (!tabs.some((t) => t.id === activeId)) {
      setActiveId(tabs[tabs.length - 1].id);
    }
  }, [tabs, activeId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const shortcutKey = e.ctrlKey || e.metaKey;
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
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeId]);

  return (
    <main className="app">
      <div className="tab-bar">
        <button
          type="button"
          className="brand"
          onClick={() => setSettingsOpen(true)}
          title={t("app.settings")}
        >
          MixDB
        </button>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={tab.id === activeId ? "tab tab-active" : "tab"}
            onClick={() => setActiveId(tab.id)}
          >
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
            <ConnectionTab onTitleChange={(title) => renameTab(tab.id, title)} />
          </div>
        ))}
      </div>

      {settingsOpen && (
        <SettingsModal
          theme={theme}
          onThemeChange={setTheme}
          accent={accent}
          onAccentChange={setAccent}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}

export default App;
