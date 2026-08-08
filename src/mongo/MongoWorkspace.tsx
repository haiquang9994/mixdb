import { useCallback, useEffect, useRef, useState } from "react";
import { mongoListCollections, mongoListDatabases } from "./api";
import Select from "../components/Select";
import ErrorBanner from "../components/ErrorBanner";
import Input from "../components/Input";
import NoSqlTable from "../components/NoSqlTable";
import ItemList from "../components/ItemList";
import itemListStyles from "../components/ItemList/ItemList.module.css";
import { useTranslation } from "../i18n";

interface Props {
  connectionId: string;
  initialDatabase?: string;
  status: string;
  error: string;
  onDisconnect: () => void;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
}

const DEFAULT_SIDEBAR_WIDTH = 200;
const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 480;

function MongoWorkspace({ connectionId, initialDatabase, error, sidebarWidth, onSidebarWidthChange }: Props) {
  const { t } = useTranslation();
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState(initialDatabase ?? "");
  const [collections, setCollections] = useState<string[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState("");
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [localError, setLocalError] = useState("");

  const [width, setWidth] = useState(sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);
  const resizing = useRef(false);

  useEffect(() => {
    setWidth(sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);
  }, [sidebarWidth]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizing.current = true;
      const startX = e.clientX;
      const startWidth = width;

      function onMouseMove(ev: MouseEvent) {
        const next = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, startWidth + (ev.clientX - startX)),
        );
        setWidth(next);
      }

      function onMouseUp(ev: MouseEvent) {
        resizing.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        const finalWidth = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, startWidth + (ev.clientX - startX)),
        );
        onSidebarWidthChange?.(finalWidth);
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [width, onSidebarWidthChange],
  );

  const handleResizeDoubleClick = useCallback(() => {
    if (collections.length === 0) {
      setWidth(DEFAULT_SIDEBAR_WIDTH);
      onSidebarWidthChange?.(DEFAULT_SIDEBAR_WIDTH);
      return;
    }
    const longest = collections.reduce((a, b) => (b.length > a.length ? b : a), "");
    const probe = document.createElement("button");
    probe.className = itemListStyles.item;
    probe.style.position = "fixed";
    probe.style.top = "-9999px";
    probe.style.left = "-9999px";
    probe.style.width = "auto";
    probe.style.whiteSpace = "nowrap";
    probe.textContent = longest;
    document.body.appendChild(probe);
    const style = getComputedStyle(probe);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    let textWidth = probe.scrollWidth;
    if (ctx) {
      ctx.font = style.font;
      textWidth = ctx.measureText(longest).width;
    }
    const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    document.body.removeChild(probe);
    const sidebarPadding = 4;
    const target = Math.ceil(textWidth + horizontalPadding + sidebarPadding);
    const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(DEFAULT_SIDEBAR_WIDTH, target));
    setWidth(next);
    onSidebarWidthChange?.(next);
  }, [collections, onSidebarWidthChange]);

  useEffect(() => {
    let cancelled = false;
    mongoListDatabases(connectionId)
      .then((dbs) => {
        if (cancelled) return;
        setDatabases(dbs);
        setSelectedDb((prev) => (prev && dbs.includes(prev) ? prev : ""));
      })
      .catch((e) => setLocalError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  useEffect(() => {
    setCollectionFilter("");
    if (!selectedDb) {
      setCollections([]);
      setSelectedCollection(null);
      return;
    }
    let cancelled = false;
    setSelectedCollection(null);
    mongoListCollections(connectionId, selectedDb)
      .then((c) => {
        if (!cancelled) setCollections(c);
      })
      .catch((e) => setLocalError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedDb]);

  const reloadCollections = useCallback(() => {
    if (!selectedDb) return;
    setCollectionsLoading(true);
    mongoListCollections(connectionId, selectedDb)
      .then((c) => setCollections(c))
      .catch((e) => setLocalError(String(e)))
      .finally(() => setCollectionsLoading(false));
  }, [connectionId, selectedDb]);

  const filteredCollections = collectionFilter.trim()
    ? collections.filter((c) => c.toLowerCase().includes(collectionFilter.trim().toLowerCase()))
    : collections;

  const collectionsEmptyMessage =
    collections.length === 0
      ? t("mongo.noCollections")
      : filteredCollections.length === 0
        ? t("mongo.noMatchingCollections")
        : undefined;

  return (
    <div className="mongo-workspace">
      <div className="mongo-header">
        <div className="mongo-header-left">
          <span className="mongo-kind-label">{t("mongo.kindLabel")}</span>
        </div>
        <label className="mongo-db-select">
          {t("mongo.databaseLabel")}{" "}
          <Select
            value={selectedDb}
            onChange={(db) => {
              setSelectedDb(db);
              setSelectedCollection(null);
            }}
            placeholder={t("mongo.databasePlaceholder")}
            size="normal"
            options={databases.map((db) => ({ value: db, label: db }))}
          />
        </label>
      </div>

      {(error || localError) && (
        <ErrorBanner message={error || localError} onDismiss={() => setLocalError("")} />
      )}

      <div className="mongo-body">
        <aside className="mongo-sidebar" style={{ flexBasis: width }}>
          <Input
            size="normal"
            className="mongo-sidebar-search"
            placeholder={t("mongo.searchCollectionsPlaceholder")}
            value={collectionFilter}
            onChange={(e) => setCollectionFilter(e.target.value)}
          />
          <ItemList
            items={filteredCollections}
            selectedItem={selectedCollection}
            onSelect={setSelectedCollection}
            emptyMessage={collectionsEmptyMessage}
          />
          <div className="mongo-sidebar-actions">
            <button
              type="button"
              className="mongo-sidebar-action"
              aria-label={t("mongo.reloadCollections")}
              title={t("mongo.reloadCollections")}
              disabled={!selectedDb || collectionsLoading}
              onClick={reloadCollections}
            >
              <svg
                className={`mongo-sidebar-action-icon${collectionsLoading ? " mongo-sidebar-action-icon-spinning" : ""}`}
                width="14"
                height="14"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path
                  d="M13.5 8a5.5 5.5 0 1 1-1.6-3.89M13.5 2v3.2h-3.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </aside>

        <div
          className="mongo-sidebar-resizer"
          onMouseDown={handleResizeStart}
          onDoubleClick={handleResizeDoubleClick}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("mongo.resizeSidebar")}
          title={t("mongo.resizeSidebarTooltip")}
        />

        <section className="mongo-content">
          {!selectedCollection && <p className="muted">{t("mongo.selectCollectionPrompt")}</p>}
          {selectedDb && selectedCollection && (
            <NoSqlTable
              connectionId={connectionId}
              selectedDb={selectedDb}
              selectedCollection={selectedCollection}
              onError={setLocalError}
              layoutWidth={width}
            />
          )}
        </section>
      </div>
    </div>
  );
}

export default MongoWorkspace;
