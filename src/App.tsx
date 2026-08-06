import { useState } from "react";
import ConnectionTab from "./ConnectionTab";
import "./App.css";

interface TabInfo {
  id: string;
  title: string;
}

function newTab(): TabInfo {
  return { id: crypto.randomUUID(), title: "New Connection" };
}

function App() {
  const [tabs, setTabs] = useState<TabInfo[]>([newTab()]);
  const [activeId, setActiveId] = useState(tabs[0].id);

  function openTab() {
    const tab = newTab();
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh = newTab();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) {
        setActiveId(next[next.length - 1].id);
      }
      return next;
    });
  }

  function renameTab(id: string, title: string) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  }

  return (
    <main className="app">
      <div className="tab-bar">
        <span className="brand">MixDB</span>
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
              title="Close tab"
            >
              ×
            </button>
          </div>
        ))}
        <button className="tab-new" onClick={openTab} title="New connection tab">
          +
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
    </main>
  );
}

export default App;
