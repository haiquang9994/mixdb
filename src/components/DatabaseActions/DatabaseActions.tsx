import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import ActionBar from "../ActionBar";
import ConfirmDialog from "../ConfirmDialog";
import DumpDialog from "../DumpDialog";
import { DownloadIcon, TrashIcon, UploadIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import { errorMessage } from "../../errors";
import { toolsInstall, toolsReady } from "../../tools";
import { mongoDropDatabase, mongoDump, mongoRestore } from "../../mongo/api";
import { mysqlDropDatabase, mysqlDump, mysqlRestore } from "../../mysql/api";
import type { MysqlDumpMode } from "../../mysql/api";

/** What the workspace is told happened, so it can reload what the change touched. */
export type DatabaseChange = "restored" | "dropped";

interface Props {
  kind: "mysql" | "mongo";
  connectionId: string;
  /** The database the three actions act on; empty when none is selected, which disables them. */
  database: string;
  disabled?: boolean;
  onError: (message: string) => void;
  onChanged: (change: DatabaseChange) => void;
  /** What is running, for the workspace's overlay — the empty string when nothing is. */
  onBusyChange: (label: string) => void;
}

/** Which action was interrupted by the tools not being there, to be resumed once they are. */
type Pending = "dump" | "restore";

/**
 * Dump, restore and drop, for the database as a whole — the right-hand end of the sidebar's
 * action bar, and every dialog those three need.
 *
 * Dumping and restoring are done by the database's own command-line tools rather than by this app
 * (see the Rust side for why), so each action first makes sure they are there and offers to fetch
 * them when they are not.
 */
function DatabaseActions({
  kind,
  connectionId,
  database,
  disabled,
  onError,
  onChanged,
  onBusyChange,
}: Props) {
  const { t } = useTranslation();
  const [choosingMode, setChoosingMode] = useState(false);
  const [installFor, setInstallFor] = useState<Pending | null>(null);
  const [restoreFrom, setRestoreFrom] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [running, setRunning] = useState(false);

  const suite = kind;
  const busy = disabled || running || database === "";

  /** Runs one tool with the overlay up, and reports whatever it says went wrong. */
  async function withBusy(label: string, work: () => Promise<void>): Promise<boolean> {
    setRunning(true);
    onBusyChange(label);
    try {
      await work();
      return true;
    } catch (e) {
      onError(errorMessage(t, e));
      return false;
    } finally {
      setRunning(false);
      onBusyChange("");
    }
  }

  /** Whether the tools are there. When they are not, asks about downloading them and remembers
   * what the user was trying to do, so the answer can carry it on. */
  async function toolsPresent(pending: Pending): Promise<boolean> {
    try {
      if (await toolsReady(suite)) return true;
    } catch (e) {
      onError(errorMessage(t, e));
      return false;
    }
    setInstallFor(pending);
    return false;
  }

  async function startDump() {
    if (!(await toolsPresent("dump"))) return;
    // Only MySQL has anything to decide; a mongodump archive is the whole database or nothing.
    if (kind === "mysql") {
      setChoosingMode(true);
    } else {
      await runDump("all");
    }
  }

  async function runDump(mode: MysqlDumpMode) {
    setChoosingMode(false);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const extension = kind === "mysql" ? "sql" : "archive";
    const path = await save({
      defaultPath: `${database}-${stamp}.${extension}`,
      filters: [
        {
          name: t(kind === "mysql" ? "dump.sqlFilter" : "dump.archiveFilter"),
          extensions: [extension],
        },
      ],
    });
    // The picker was dismissed: nothing to report, and nothing to run.
    if (typeof path !== "string") return;
    await withBusy(t("dump.dumping", { database }), () =>
      kind === "mysql"
        ? mysqlDump(connectionId, database, mode, path)
        : mongoDump(connectionId, database, path),
    );
  }

  async function startRestore() {
    if (!(await toolsPresent("restore"))) return;
    const extension = kind === "mysql" ? "sql" : "archive";
    const path = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: t(kind === "mysql" ? "dump.sqlFilter" : "dump.archiveFilter"),
          extensions: [extension],
        },
      ],
    });
    if (typeof path !== "string") return;
    setRestoreFrom(path);
  }

  async function runRestore(path: string) {
    setRestoreFrom(null);
    const ok = await withBusy(t("dump.restoring", { database }), () =>
      kind === "mysql"
        ? mysqlRestore(connectionId, database, path)
        : mongoRestore(connectionId, database, path),
    );
    // Even a failed restore may have got part of the way through, so the lists are stale either
    // way and are reloaded regardless.
    onChanged("restored");
    return ok;
  }

  async function install() {
    const pending = installFor;
    setInstallFor(null);
    const ok = await withBusy(t("dump.installing"), () => toolsInstall(suite));
    if (!ok) return;
    if (pending === "dump") await startDump();
    if (pending === "restore") await startRestore();
  }

  async function drop() {
    setDropping(false);
    const ok = await withBusy(t("dump.dropping", { database }), () =>
      kind === "mysql"
        ? mysqlDropDatabase(connectionId, database)
        : mongoDropDatabase(connectionId, database),
    );
    if (ok) onChanged("dropped");
  }

  return (
    <>
      <ActionBar
        actions={[
          {
            key: "dump",
            icon: DownloadIcon,
            label: t("dump.dump"),
            disabled: busy,
            onClick: () => void startDump(),
          },
          {
            key: "restore",
            icon: UploadIcon,
            label: t("dump.restore"),
            disabled: busy,
            onClick: () => void startRestore(),
          },
          {
            key: "drop",
            icon: TrashIcon,
            label: t("dump.drop"),
            danger: true,
            disabled: busy,
            onClick: () => setDropping(true),
          },
        ]}
      />

      {choosingMode && (
        <DumpDialog
          database={database}
          onCancel={() => setChoosingMode(false)}
          onSubmit={(mode) => void runDump(mode)}
        />
      )}

      {installFor !== null && (
        <ConfirmDialog
          title={t("dump.installTitle")}
          message={t(kind === "mysql" ? "dump.installMysql" : "dump.installMongo")}
          confirmLabel={t("dump.installConfirm")}
          onConfirm={() => void install()}
          onCancel={() => setInstallFor(null)}
        />
      )}

      {restoreFrom !== null && (
        <ConfirmDialog
          title={t("dump.restoreTitle", { database })}
          message={t(kind === "mysql" ? "dump.restoreMysql" : "dump.restoreMongo", {
            file: restoreFrom,
            database,
          })}
          confirmLabel={t("dump.restoreConfirm")}
          danger
          onConfirm={() => void runRestore(restoreFrom)}
          onCancel={() => setRestoreFrom(null)}
        />
      )}

      {dropping && (
        <ConfirmDialog
          title={t("dump.dropTitle")}
          message={t(kind === "mysql" ? "dump.dropMysqlMessage" : "dump.dropMongoMessage", {
            database,
          })}
          confirmLabel={t("common.delete")}
          danger
          onConfirm={() => void drop()}
          onCancel={() => setDropping(false)}
        />
      )}
    </>
  );
}

export default DatabaseActions;
