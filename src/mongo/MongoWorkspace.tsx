import { useCallback, useEffect, useRef, useState } from "react";
import {
  mongoCreateCollection,
  mongoDropCollection,
  mongoListCollections,
  mongoListDatabases,
  mongoRenameCollection,
  mongoServerInfo,
} from "./api";
import Select from "../components/Select";
import ConfirmDialog from "../components/ConfirmDialog";
import ErrorBanner from "../components/ErrorBanner";
import Input from "../components/Input";
import NameDialog from "../components/NameDialog";
import NoSqlTable from "../components/NoSqlTable";
import ActionBar from "../components/ActionBar";
import ItemList from "../components/ItemList";
import type { ItemAction } from "../components/ItemList";
import itemListStyles from "../components/ItemList/ItemList.module.css";
import { PlusIcon, ReloadIcon } from "../icons";
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

/** The panes the content area can show. Only the document list exists so far, but the header is
 * already a tab strip so a second one (indexes, aggregations, …) is a case here and a branch
 * below rather than a reshuffle of the layout — same as the MySQL side. */
type ContentMode = "data";

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
  const [contentMode, setContentMode] = useState<ContentMode>("data");
  const [localError, setLocalError] = useState("");
  const [serverInfo, setServerInfo] = useState<{ version: string; os: string } | null>(null);
  const [creatingCollection, setCreatingCollection] = useState(false);
  /** The collection the context menu's rename is open on, and the one its drop is asking about. */
  const [renamingCollection, setRenamingCollection] = useState<string | null>(null);
  const [droppingCollection, setDroppingCollection] = useState<string | null>(null);

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
    let cancelled = false;
    setServerInfo(null);
    mongoServerInfo(connectionId)
      .then((info) => {
        if (!cancelled) setServerInfo(info);
      })
      .catch(() => {
        // Non-critical display info — silently omit it on failure.
      });
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

  /** Creates the collection and leaves it selected, empty and ready to be inserted into. Errors
   * reject back into the dialog, which is what shows them and stays open. */
  async function createCollection(name: string) {
    await mongoCreateCollection(connectionId, selectedDb, name);
    setCreatingCollection(false);
    // Cleared so the new collection is visible whatever was being searched for when it was made.
    setCollectionFilter("");
    setSelectedCollection(name);
    reloadCollections();
  }

  /** Renames the collection and follows it: whatever was open on it stays open, under the new
   * name. Errors reject back into the dialog, which is what shows them and stays open. */
  async function renameCollection(collection: string, newName: string) {
    await mongoRenameCollection(connectionId, selectedDb, collection, newName);
    setRenamingCollection(null);
    setCollectionFilter("");
    if (selectedCollection === collection) setSelectedCollection(newName);
    reloadCollections();
  }

  /** Drops the collection the confirmation was asking about. */
  async function dropCollection(collection: string) {
    setDroppingCollection(null);
    try {
      await mongoDropCollection(connectionId, selectedDb, collection);
      if (selectedCollection === collection) setSelectedCollection(null);
      reloadCollections();
    } catch (e) {
      setLocalError(String(e));
    }
  }

  const collectionActions: ItemAction[] = [
    { key: "rename", label: t("mongo.renameCollection"), onSelect: setRenamingCollection },
    { key: "drop", label: t("mongo.dropCollection"), danger: true, onSelect: setDroppingCollection },
  ];

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
          {serverInfo && (
            <span className="mongo-server-info">
              {t("mongo.serverInfo", { os: serverInfo.os, version: serverInfo.version })}
            </span>
          )}
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
            searchable
            searchPlaceholder={t("mongo.searchDatabasesPlaceholder")}
            options={databases.map((db) => ({ value: db, label: db }))}
          />
        </label>
        <div className="method-tabs mongo-content-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={contentMode === "data"}
            className={`method-tab${contentMode === "data" ? " method-tab-active" : ""}`}
            onClick={() => setContentMode("data")}
          >
            {t("mongo.dataTab")}
          </button>
        </div>
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
            actions={collectionActions}
          />
          <ActionBar
            className="mongo-sidebar-actions"
            actions={[
              {
                key: "reload",
                icon: ReloadIcon,
                label: t("mongo.reloadCollections"),
                disabled: !selectedDb || collectionsLoading,
                busy: collectionsLoading,
                onClick: reloadCollections,
              },
              {
                key: "add",
                icon: PlusIcon,
                label: t("mongo.addCollection"),
                disabled: !selectedDb || collectionsLoading,
                onClick: () => setCreatingCollection(true),
              },
            ]}
          />
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
          {contentMode === "data" && !selectedCollection && (
            <p className="muted">{t("mongo.selectCollectionPrompt")}</p>
          )}
          {contentMode === "data" && selectedDb && selectedCollection && (
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

      {creatingCollection && selectedDb && (
        <NameDialog
          title={t("collectionDialog.title", { database: selectedDb })}
          ariaLabel={selectedDb}
          label={t("collectionDialog.name")}
          emptyError={t("collectionDialog.errorName")}
          submitLabel={t("collectionDialog.submit")}
          savingLabel={t("collectionDialog.saving")}
          onCancel={() => setCreatingCollection(false)}
          onSubmit={createCollection}
        />
      )}

      {renamingCollection !== null && (
        <NameDialog
          title={t("mongo.renameCollectionTitle", { collection: renamingCollection })}
          ariaLabel={renamingCollection}
          label={t("renameDialog.name")}
          initialName={renamingCollection}
          emptyError={t("renameDialog.errorName")}
          submitLabel={t("renameDialog.submit")}
          savingLabel={t("renameDialog.saving")}
          onCancel={() => setRenamingCollection(null)}
          onSubmit={(newName) => renameCollection(renamingCollection, newName)}
        />
      )}

      {droppingCollection !== null && (
        <ConfirmDialog
          title={t("mongo.dropCollectionTitle")}
          message={t("mongo.dropCollectionMessage", { collection: droppingCollection })}
          confirmLabel={t("common.delete")}
          danger
          onConfirm={() => void dropCollection(droppingCollection)}
          onCancel={() => setDroppingCollection(null)}
        />
      )}
    </div>
  );
}

export default MongoWorkspace;
