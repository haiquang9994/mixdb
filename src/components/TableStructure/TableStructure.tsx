import { useEffect, useState } from "react";
import {
  mysqlAddColumn,
  mysqlAddIndex,
  mysqlCollations,
  mysqlDropColumn,
  mysqlDropIndex,
  mysqlModifyColumn,
  mysqlModifyIndex,
  mysqlTableStructure,
} from "../../mysql/api";
import ActionBar from "../ActionBar";
import ColumnDialog from "../ColumnDialog";
import ConfirmDialog from "../ConfirmDialog";
import IndexDialog, { indexKind } from "../IndexDialog";
import LoadingOverlay from "../LoadingOverlay";
import { PencilIcon, PlusIcon, ReloadIcon, TrashIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import type {
  MysqlCollation,
  MysqlColumnSpec,
  MysqlIndexSpec,
  MysqlStructureColumn,
  MysqlTableIndex,
  MysqlTableStructure,
} from "../../types";
import styles from "./TableStructure.module.css";

/** What the Kind column says an index is — the same reading of it the edit dialog opens on. */
const INDEX_KIND_LABEL = {
  primary: "structure.kindPrimary",
  unique: "structure.kindUnique",
  fulltext: "structure.kindFulltext",
  spatial: "structure.kindSpatial",
  index: "structure.kindIndex",
} as const;

/** How the index is stored, when that is a choice the index had. `FULLTEXT`/`SPATIAL` name a kind
 * rather than a structure, and the Kind column already says so. */
function indexMethod(index: MysqlTableIndex): string {
  const type = index.indexType.toUpperCase();
  return type === "BTREE" || type === "HASH" ? type : "";
}

/** An index over an expression rather than over columns. Its expression is not read here, so such
 * an index cannot be rebuilt from what the grid knows — only dropped. */
function isFunctional(index: MysqlTableIndex): boolean {
  return index.columns.some((column) => column.name === null);
}

/** Which dialog is open and on what: an entry with nothing in it is the "add" form. */
type ColumnDialogState = { column?: MysqlStructureColumn };
type IndexDialogState = { index?: MysqlTableIndex };
/** What the confirmation is about to drop. */
type PendingDrop = { kind: "column"; name: string } | { kind: "index"; name: string };

interface Props {
  connectionId: string;
  selectedDb: string;
  selectedTable: string;
  onError: (message: string) => void;
}

/**
 * The table's shape: its columns above, its indexes below, each with its own add/edit/drop.
 *
 * Every change is one `ALTER TABLE` sent by itself and followed by a reload, rather than a batch
 * of pending edits applied together — a rejected ALTER then names the one thing that was wrong
 * with it, and what the grid shows afterwards is what the server actually has.
 */
function TableStructure({ connectionId, selectedDb, selectedTable, onError }: Props) {
  const { t } = useTranslation();
  const [structure, setStructure] = useState<MysqlTableStructure | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Bumped after every change (and by the reload action) to re-run the fetch below.
  const [reloadToken, setReloadToken] = useState(0);
  const [columnDialog, setColumnDialog] = useState<ColumnDialogState | null>(null);
  const [indexDialog, setIndexDialog] = useState<IndexDialogState | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [collations, setCollations] = useState<MysqlCollation[]>([]);

  // Read once per connection rather than per table: the list belongs to the server, and every
  // column dialog opened on it picks from the same one.
  useEffect(() => {
    let cancelled = false;
    mysqlCollations(connectionId)
      .then((result) => {
        if (!cancelled) setCollations(result);
      })
      // Not worth an error banner over: without a list the dialog falls back to a text box, which
      // is what it was before there was one.
      .catch(() => {
        if (!cancelled) setCollations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    mysqlTableStructure(connectionId, selectedDb, selectedTable)
      .then((result) => {
        if (!cancelled) setStructure(result);
      })
      .catch((e) => {
        if (cancelled) return;
        // The previous table's structure would otherwise stay on screen under this table's name.
        setStructure(null);
        onError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedDb, selectedTable, reloadToken]);

  const columns = structure?.columns ?? [];
  const indexes = structure?.indexes ?? [];
  const busy = loading || saving;

  function reload() {
    setReloadToken((n) => n + 1);
  }

  /** Runs one change and reloads on success. Errors are left to reject so the dialog that asked
   * for the change can show them and stay open; a drop has no dialog, so it reports its own. */
  async function apply(change: () => Promise<void>) {
    setSaving(true);
    try {
      await change();
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function submitColumn(spec: MysqlColumnSpec) {
    const original = columnDialog?.column;
    await apply(() =>
      original
        ? mysqlModifyColumn(connectionId, selectedDb, selectedTable, original.name, spec)
        : mysqlAddColumn(connectionId, selectedDb, selectedTable, spec),
    );
    setColumnDialog(null);
  }

  async function submitIndex(spec: MysqlIndexSpec) {
    const original = indexDialog?.index;
    await apply(() =>
      original
        ? mysqlModifyIndex(connectionId, selectedDb, selectedTable, original.name, spec)
        : mysqlAddIndex(connectionId, selectedDb, selectedTable, spec),
    );
    setIndexDialog(null);
  }

  async function confirmDrop() {
    const target = pendingDrop;
    setPendingDrop(null);
    if (!target) return;
    try {
      await apply(() =>
        target.kind === "column"
          ? mysqlDropColumn(connectionId, selectedDb, selectedTable, target.name)
          : mysqlDropIndex(connectionId, selectedDb, selectedTable, target.name),
      );
    } catch (e) {
      onError(String(e));
    }
  }

  return (
    <div className={styles.structure}>
      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h4 className={styles.panelTitle}>{t("structure.columnsTitle")}</h4>
          <ActionBar
            actions={[
              {
                key: "reload",
                icon: ReloadIcon,
                label: t("structure.reload"),
                disabled: busy,
                busy: loading,
                onClick: reload,
              },
              {
                key: "add",
                icon: PlusIcon,
                label: t("structure.addColumn"),
                disabled: busy,
                onClick: () => setColumnDialog({}),
              },
            ]}
          />
        </header>
        <div className={styles.gridWrap}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th className={styles.rowNumber}>#</th>
                <th>{t("structure.colName")}</th>
                <th>{t("structure.colType")}</th>
                <th>{t("structure.colNullable")}</th>
                <th>{t("structure.colDefault")}</th>
                <th>{t("structure.colExtra")}</th>
                <th>{t("structure.colCollation")}</th>
                <th>{t("structure.colComment")}</th>
                <th className={styles.rowActions} />
              </tr>
            </thead>
            <tbody>
              {columns.map((column, i) => (
                <tr key={column.name}>
                  <td className={styles.rowNumber}>{i + 1}</td>
                  <td>
                    <span className={styles.name}>{column.name}</span>
                    {column.key === "PRI" && (
                      <span
                        className={`${styles.badge} ${styles.badgeKey}`}
                        title={t("structure.primaryTooltip")}
                      >
                        PK
                      </span>
                    )}
                    {column.key === "UNI" && (
                      <span className={styles.badge} title={t("structure.uniqueTooltip")}>
                        UQ
                      </span>
                    )}
                    {column.key === "MUL" && (
                      <span className={styles.badge} title={t("structure.indexTooltip")}>
                        IX
                      </span>
                    )}
                    {column.autoIncrement && (
                      <span className={styles.badge} title={t("structure.autoIncrementTooltip")}>
                        AI
                      </span>
                    )}
                  </td>
                  <td className={styles.mono}>{column.dataType}</td>
                  <td className={column.nullable ? undefined : styles.muted}>
                    {t(column.nullable ? "structure.yes" : "structure.no")}
                  </td>
                  <td className={column.defaultValue === null ? styles.muted : styles.mono}>
                    {column.defaultValue ?? t("structure.none")}
                  </td>
                  <td className={styles.muted} title={column.extra}>
                    {column.extra || t("structure.none")}
                  </td>
                  <td className={styles.muted}>{column.collation ?? t("structure.none")}</td>
                  <td title={column.comment}>{column.comment}</td>
                  <td className={styles.rowActions}>
                    <div className={styles.rowButtons}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        // A generated column's expression is not read here, so re-issuing its
                        // definition would drop the very thing that defines it.
                        disabled={busy || column.generated}
                        title={
                          column.generated
                            ? t("structure.generatedTooltip")
                            : t("structure.editColumn")
                        }
                        aria-label={t("structure.editColumn")}
                        onClick={() => setColumnDialog({ column })}
                      >
                        <PencilIcon size={14} />
                      </button>
                      <button
                        type="button"
                        className={`${styles.iconButton} ${styles.danger}`}
                        disabled={busy}
                        title={t("structure.dropColumn")}
                        aria-label={t("structure.dropColumn")}
                        onClick={() => setPendingDrop({ kind: "column", name: column.name })}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && columns.length === 0 && <p className="muted">{t("structure.noColumns")}</p>}
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h4 className={styles.panelTitle}>{t("structure.indexesTitle")}</h4>
          <ActionBar
            actions={[
              {
                key: "add",
                icon: PlusIcon,
                label: t("structure.addIndex"),
                disabled: busy || columns.length === 0,
                onClick: () => setIndexDialog({}),
              },
            ]}
          />
        </header>
        <div className={styles.gridWrap}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th>{t("structure.indexName")}</th>
                <th>{t("structure.indexKind")}</th>
                <th>{t("structure.indexMethod")}</th>
                <th>{t("structure.indexColumns")}</th>
                <th>{t("structure.indexComment")}</th>
                <th className={styles.rowActions} />
              </tr>
            </thead>
            <tbody>
              {indexes.map((index) => {
                const functional = isFunctional(index);
                return (
                  <tr key={index.name}>
                    <td>
                      <span className={styles.name}>{index.name}</span>
                    </td>
                    <td>
                      <span
                        className={
                          index.primary ? `${styles.badge} ${styles.badgeKey}` : styles.badge
                        }
                      >
                        {t(INDEX_KIND_LABEL[indexKind(index)])}
                      </span>
                    </td>
                    <td className={styles.muted}>{indexMethod(index) || t("structure.none")}</td>
                    <td className={styles.mono}>
                      {index.columns
                        .map((column) => {
                          const name = column.name ?? t("structure.indexExpression");
                          return column.prefixLength === null
                            ? name
                            : `${name}(${column.prefixLength})`;
                        })
                        .join(", ")}
                    </td>
                    <td title={index.comment}>{index.comment}</td>
                    <td className={styles.rowActions}>
                      <div className={styles.rowButtons}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          disabled={busy || functional}
                          title={
                            functional
                              ? t("structure.functionalIndexTooltip")
                              : t("structure.editIndex")
                          }
                          aria-label={t("structure.editIndex")}
                          onClick={() => setIndexDialog({ index })}
                        >
                          <PencilIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.iconButton} ${styles.danger}`}
                          disabled={busy}
                          title={t("structure.dropIndex")}
                          aria-label={t("structure.dropIndex")}
                          onClick={() => setPendingDrop({ kind: "index", name: index.name })}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && indexes.length === 0 && <p className="muted">{t("structure.noIndexes")}</p>}
        </div>
      </section>

      {(loading || saving) && (
        <LoadingOverlay label={saving ? t("structure.saving") : t("structure.loading")} />
      )}

      {columnDialog !== null && (
        <ColumnDialog
          table={selectedTable}
          columns={columns}
          collations={collations}
          column={columnDialog.column}
          onCancel={() => setColumnDialog(null)}
          onSubmit={submitColumn}
        />
      )}

      {indexDialog !== null && (
        <IndexDialog
          table={selectedTable}
          columns={columns.map((c) => c.name)}
          index={indexDialog.index}
          onCancel={() => setIndexDialog(null)}
          onSubmit={submitIndex}
        />
      )}

      {pendingDrop !== null && (
        <ConfirmDialog
          title={t(
            pendingDrop.kind === "column" ? "structure.dropColumnTitle" : "structure.dropIndexTitle",
          )}
          message={
            pendingDrop.kind === "column"
              ? t("structure.dropColumnMessage", { column: pendingDrop.name })
              : t("structure.dropIndexMessage", { index: pendingDrop.name })
          }
          confirmLabel={t("common.delete")}
          danger
          onConfirm={() => void confirmDrop()}
          onCancel={() => setPendingDrop(null)}
        />
      )}
    </div>
  );
}

export default TableStructure;
