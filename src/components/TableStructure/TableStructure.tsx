import { useEffect, useMemo, useRef, useState } from "react";
import { gridStyle, useVirtualRows, widestValues } from "../../virtualRows";
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
import { invalidateSchemaOutline } from "../../mysql/schemaCache";
import ActionBar from "../ActionBar";
import ColumnDialog from "../ColumnDialog";
import ConfirmDialog from "../ConfirmDialog";
import IndexDialog, { indexKind } from "../IndexDialog";
import LoadingOverlay from "../LoadingOverlay";
import { PencilIcon, PlusIcon, ReloadIcon, TrashIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import { errorMessage } from "../../errors";
import { useReloadShortcut, withReloadShortcut } from "../../reload";
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

/** Where holding every row in the DOM stops being the cheap thing to do. Most tables have fewer
 *  columns than this and nothing here applies to them; a wide table has hundreds, and then the
 *  whole grid is laid out again every time the tab is opened — this panel is unmounted when the
 *  header leaves it, so that is every visit rather than only the first. */
const VIRTUAL_FROM = 60;

/** How tall a row of these grids is — stated, never measured; see `virtualRows.ts` for why that
 *  distinction is what makes a window of rows sound. 33px is what a row here has always come to: a
 *  24px line (the row buttons are 24px too), 4px of padding above and below, and the 1px rule. */
const ROW_HEIGHT = 33;

/** Which dialog is open and on what: an entry with nothing in it is the "add" form. */
type ColumnDialogState = { column?: MysqlStructureColumn };
type IndexDialogState = { index?: MysqlTableIndex };
/** What the confirmation is about to drop. */
type PendingDrop = { kind: "column"; name: string } | { kind: "index"; name: string };

/** The shape on screen and the table it was read from, held together: a table selected while the
 * tab was hidden must not leave the previous one's columns under its name. */
interface Cache {
  table: string;
  structure: MysqlTableStructure;
}

interface Props {
  /** Whether this is what the user is actually looking at — the Structure tab, in the connection
   *  tab the tab bar is showing. This stays mounted behind both, so it is what says when the shape
   *  is worth reading, when a read the user cannot see would be wasted, and which of the panes
   *  mounted at once `Ctrl+R` belongs to. */
  active: boolean;
  connectionId: string;
  selectedDb: string;
  selectedTable: string;
  onError: (message: string) => void;
  /** The saved connection is marked as one nothing is written to. The columns and indexes are
   *  still read and shown; every `ALTER TABLE` this panel can send is what goes. */
  readOnly?: boolean;
}

/**
 * The table's shape: its columns above, its indexes below, each with its own add/edit/drop.
 *
 * Every change is one `ALTER TABLE` sent by itself and followed by a reload, rather than a batch
 * of pending edits applied together — a rejected ALTER then names the one thing that was wrong
 * with it, and what the grid shows afterwards is what the server actually has.
 *
 * Read once and kept: the workspace leaves this mounted while another tab is up, so moving between
 * the tabs shows the shape already read rather than asking for it again. It is only re-read when
 * the table changes under it, when an `ALTER` this panel sent means the server no longer matches,
 * or when the reload asks; a table selected while the tab was hidden waits until it is looked at
 * again before costing anything.
 */
function TableStructure({
  active,
  connectionId,
  selectedDb,
  selectedTable,
  onError,
  readOnly = false,
}: Props) {
  const { t } = useTranslation();
  const [cache, setCache] = useState<Cache | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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

  /** The table the panel is showing, as one string: what the cache below is keyed on. */
  const tableKey = `${selectedDb} :: ${selectedTable}`;
  /** What has been read for the table now selected, or null when that is nothing yet — which is
   *  also what a cache left over from another table counts as, so the previous table's columns can
   *  never appear under this one's name. */
  const structure = cache?.table === tableKey ? cache.structure : null;

  useEffect(() => {
    // Nothing to do until the tab is looked at, and nothing to do once it has been read: this is
    // what makes moving between the tabs free.
    if (!active || structure !== null) return;
    let cancelled = false;
    setLoading(true);
    mysqlTableStructure(connectionId, selectedDb, selectedTable)
      .then((result) => {
        if (!cancelled) setCache({ table: tableKey, structure: result });
      })
      .catch((e) => {
        if (cancelled) return;
        // Nothing is cached for a read that failed, so coming back to the tab tries again rather
        // than settling on an empty panel.
        onError(errorMessage(t, e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedDb, selectedTable, tableKey, active, structure]);

  const columns = structure?.columns ?? [];
  const indexes = structure?.indexes ?? [];
  const busy = loading || saving;

  // Each grid holds only the rows on screen once it is worth it. Everything either grid does — the
  // edit and drop buttons, the reload, the dialogs — works off `columns` and `indexes` rather than
  // off what is drawn, so none of it notices.
  const columnScroll = useRef<HTMLDivElement>(null);
  const indexScroll = useRef<HTMLDivElement>(null);
  const columnsVirtual = columns.length >= VIRTUAL_FROM;
  const indexesVirtual = indexes.length >= VIRTUAL_FROM;
  const columnView = useVirtualRows(columnScroll, {
    total: columns.length,
    rowHeight: ROW_HEIGHT,
    enabled: columnsVirtual,
  });
  const indexView = useVirtualRows(indexScroll, {
    total: indexes.length,
    rowHeight: ROW_HEIGHT,
    enabled: indexesVirtual,
  });

  /** The widest few values of each column of each grid, for the sizer rows below. Three rather than
   *  one because length is only an approximation of width — all three go in, and the browser picks
   *  between them the same way it picks between real rows. */
  const widestColumn = useMemo(
    () =>
      widestValues(columns, 8, (column, c) =>
        [
          "",
          column.name,
          column.dataType,
          t(column.nullable ? "structure.yes" : "structure.no"),
          column.defaultValue ?? t("structure.none"),
          column.extra || t("structure.none"),
          column.collation ?? t("structure.none"),
          column.comment,
        ][c]
      ),
    [columns, t]
  );
  /** Whether any column carries badges beside its name, and how many at once — the widest name has
   *  to leave room for them, and a table with none of them should not be given the room. */
  const columnBadges = useMemo(
    () => Math.max(0, ...columns.map((c) => (c.key === "" ? 0 : 1) + (c.autoIncrement ? 1 : 0))),
    [columns]
  );
  const widestIndex = useMemo(
    () =>
      widestValues(indexes, 5, (index, c) =>
        [
          index.name,
          t(INDEX_KIND_LABEL[indexKind(index)]),
          indexMethod(index) || t("structure.none"),
          index.columns
            .map((column) =>
              column.prefixLength === null
                ? (column.name ?? t("structure.indexExpression"))
                : `${column.name ?? t("structure.indexExpression")}(${column.prefixLength})`
            )
            .join(", "),
          index.comment,
        ][c]
      ),
    [indexes, t]
  );
  /** What every button that would send an `ALTER TABLE` is gated on. The reload beside them is
   *  not: reading is the one thing a read-only connection is for. */
  const noWrites = busy || readOnly;
  /** Why they are greyed out, when it is not simply that the panel is mid-request. */
  const noWritesHint = readOnly ? t("common.readOnlyConnection") : undefined;

  function reload() {
    // A column added, changed or dropped here is a column the Query tab's completion is now wrong
    // about, and this runs after every one of them.
    invalidateSchemaOutline(connectionId, selectedDb);
    // Dropping the cache is the reload: the effect above reads again the moment it finds nothing
    // for the table on screen.
    setCache(null);
  }

  // Gated on the same state the button below is: a re-read asked for while one is already out, or
  // over an `ALTER` still running, is one the button would refuse. Not from behind the column or
  // index form either — that is a half-filled definition the keyboard belongs to — nor from behind
  // the drop confirmation, which is a question about the very thing a reload would replace.
  useReloadShortcut(
    active && columnDialog === null && indexDialog === null && pendingDrop === null,
    () => {
      if (busy) return;
      reload();
    }
  );

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
      onError(errorMessage(t, e));
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
                label: withReloadShortcut(t("structure.reload")),
                disabled: busy,
                busy: loading,
                onClick: reload,
              },
              {
                key: "add",
                icon: PlusIcon,
                label: t("structure.addColumn"),
                disabled: noWrites,
                disabledHint: noWritesHint,
                onClick: () => setColumnDialog({}),
              },
            ]}
          />
        </header>
        <div
          className={styles.gridWrap}
          ref={columnScroll}
          onScroll={columnsVirtual ? columnView.onScroll : undefined}
        >
          <table
            className={columnsVirtual ? `${styles.grid} ${styles.gridRows}` : styles.grid}
            style={columnsVirtual ? gridStyle(ROW_HEIGHT, null) : undefined}
          >
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
              {/* What gives every column its width while only a few dozen rows are in the table: a
                  row of no height holding the widest cell of each, drawn the way a real row draws
                  it — badges beside the name, a pair of buttons in the actions column — so the
                  browser's own layout sizes the grid around something that cannot scroll away. */}
              {columnsVirtual && (
                <tr className={styles.sizerRow} aria-hidden="true">
                  <td className={styles.rowNumber}>
                    <div className={styles.sizer}>{columns.length}</div>
                  </td>
                  <td>
                    <div className={styles.sizer}>
                      {widestColumn[1].map((value) => (
                        <div key={value}>
                          <span className={styles.name}>{value}</span>
                          {Array.from({ length: columnBadges }, (_, n) => (
                            <span key={n} className={styles.badge}>
                              PK
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className={styles.mono}>
                    <div className={styles.sizer}>
                      {widestColumn[2].map((value) => (
                        <div key={value}>{value}</div>
                      ))}
                    </div>
                  </td>
                  {[3, 6].map((column) => (
                    <td key={column} className={styles.muted}>
                      <div className={styles.sizer}>
                        {widestColumn[column].map((value) => (
                          <div key={value}>{value}</div>
                        ))}
                      </div>
                    </td>
                  ))}
                  <td className={styles.mono}>
                    <div className={styles.sizer}>
                      {widestColumn[4].map((value) => (
                        <div key={value}>{value}</div>
                      ))}
                    </div>
                  </td>
                  <td className={styles.muted}>
                    <div className={styles.sizer}>
                      {widestColumn[5].map((value) => (
                        <div key={value}>{value}</div>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className={styles.sizer}>
                      {widestColumn[7].map((value) => (
                        <div key={value}>{value}</div>
                      ))}
                    </div>
                  </td>
                  <td className={styles.rowActions}>
                    <div className={styles.sizer}>
                      <div className={styles.rowButtons}>
                        <span className={styles.iconButton}>
                          <PencilIcon size={14} />
                        </span>
                        <span className={styles.iconButton}>
                          <TrashIcon size={14} />
                        </span>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {columnsVirtual && (
                <tr
                  className={styles.spacer}
                  style={{ height: columnView.padTop }}
                  aria-hidden="true"
                >
                  <td colSpan={9} />
                </tr>
              )}
              {columns.slice(columnView.first, columnView.last).map((column, offset) => {
                // The index into the whole list rather than into what is drawn, since it is what
                // the `#` column counts.
                const i = columnView.first + offset;
                return (
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
                          disabled={noWrites || column.generated}
                          title={
                            column.generated
                              ? t("structure.generatedTooltip")
                              : (noWritesHint ?? t("structure.editColumn"))
                          }
                          aria-label={t("structure.editColumn")}
                          onClick={() => setColumnDialog({ column })}
                        >
                          <PencilIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.iconButton} ${styles.danger}`}
                          disabled={noWrites}
                          title={noWritesHint ?? t("structure.dropColumn")}
                          aria-label={t("structure.dropColumn")}
                          onClick={() => setPendingDrop({ kind: "column", name: column.name })}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {columnsVirtual && (
                <tr
                  className={styles.spacer}
                  style={{ height: columnView.padBottom }}
                  aria-hidden="true"
                >
                  <td colSpan={9} />
                </tr>
              )}
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
                disabled: noWrites || columns.length === 0,
                disabledHint: noWritesHint,
                onClick: () => setIndexDialog({}),
              },
            ]}
          />
        </header>
        <div
          className={styles.gridWrap}
          ref={indexScroll}
          onScroll={indexesVirtual ? indexView.onScroll : undefined}
        >
          <table
            className={indexesVirtual ? `${styles.grid} ${styles.gridRows}` : styles.grid}
            style={indexesVirtual ? gridStyle(ROW_HEIGHT, null) : undefined}
          >
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
              {/* The same sizer as the grid above: the widest cell of each column, drawn the way a
                  real row draws it — the Kind badge included, since a badge is most of that
                  column's width. */}
              {indexesVirtual && (
                <tr className={styles.sizerRow} aria-hidden="true">
                  <td>
                    <div className={styles.sizer}>
                      {widestIndex[0].map((value) => (
                        <div key={value}>
                          <span className={styles.name}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className={styles.sizer}>
                      {widestIndex[1].map((value) => (
                        <div key={value}>
                          <span className={`${styles.badge} ${styles.kindBadge}`}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className={styles.muted}>
                    <div className={styles.sizer}>
                      {widestIndex[2].map((value) => (
                        <div key={value}>{value}</div>
                      ))}
                    </div>
                  </td>
                  <td className={styles.mono}>
                    <div className={styles.sizer}>
                      {widestIndex[3].map((value) => (
                        <div key={value}>{value}</div>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className={styles.sizer}>
                      {widestIndex[4].map((value) => (
                        <div key={value}>{value}</div>
                      ))}
                    </div>
                  </td>
                  <td className={styles.rowActions}>
                    <div className={styles.sizer}>
                      <div className={styles.rowButtons}>
                        <span className={styles.iconButton}>
                          <PencilIcon size={14} />
                        </span>
                        <span className={styles.iconButton}>
                          <TrashIcon size={14} />
                        </span>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {indexesVirtual && (
                <tr
                  className={styles.spacer}
                  style={{ height: indexView.padTop }}
                  aria-hidden="true"
                >
                  <td colSpan={6} />
                </tr>
              )}
              {indexes.slice(indexView.first, indexView.last).map((index) => {
                const functional = isFunctional(index);
                return (
                  <tr key={index.name}>
                    <td>
                      <span className={styles.name}>{index.name}</span>
                    </td>
                    <td>
                      <span
                        className={`${styles.badge} ${styles.kindBadge}${
                          index.primary ? ` ${styles.badgeKey}` : ""
                        }`}
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
                          disabled={noWrites || functional}
                          title={
                            functional
                              ? t("structure.functionalIndexTooltip")
                              : (noWritesHint ?? t("structure.editIndex"))
                          }
                          aria-label={t("structure.editIndex")}
                          onClick={() => setIndexDialog({ index })}
                        >
                          <PencilIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.iconButton} ${styles.danger}`}
                          disabled={noWrites}
                          title={noWritesHint ?? t("structure.dropIndex")}
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
              {indexesVirtual && (
                <tr
                  className={styles.spacer}
                  style={{ height: indexView.padBottom }}
                  aria-hidden="true"
                >
                  <td colSpan={6} />
                </tr>
              )}
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
