import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  addConnection,
  removeConnection,
  updateConnection,
  useSavedConnections,
  useSavedConnectionsLoaded,
} from "./savedConnectionsStore";
import { DEFAULT_PORTS, type ConnectionConfig, type DbKind, type SavedConnection, type SshConfig } from "./types";
import { parseDbTabState } from "./tabState";
import SqlWorkspace from "./sql/SqlWorkspace";
import { SqlProvider } from "./sql/context";
import type { SqlApi } from "./sql/api";
import type { SqlDialect } from "./sql/dialect";
import { mysqlApi } from "./mysql/api";
import { mysqlDialect } from "./mysql/dialect";
import { postgresApi } from "./postgres/api";
import { postgresDialect } from "./postgres/dialect";
import MongoWorkspace from "./mongo/MongoWorkspace";
import RedisWorkspace from "./redis/RedisWorkspace";
import Select from "../../components/Select";
import ErrorBanner from "../../components/ErrorBanner";
import ConfirmDialog from "../../components/ConfirmDialog";
import ContextMenu from "../../components/ContextMenu";
import Button from "../../components/Button";
import Input from "../../components/Input";
import { EyeIcon, EyeOffIcon, LockIcon, PinIcon } from "../../icons";
import { DatabaseIcon } from "./icons";
import { IS_MAC, IS_WINDOWS } from "../../core/platform";
import { useTranslation, type TranslationKey } from "../../i18n";
import { errorMessage } from "../../core/errors";
import type { ModuleTabProps, TabBadge } from "../../shell/module";
import { dbBadgeMarks } from "./badges";
/* The module's own global stylesheet: the connection form, the saved list and the three
   workspaces. Component-scoped rules live in each component's CSS Module. */
import "./db.css";


/** What each kind is called on the tab that picks it, and — read aloud — beside its logo in the
 *  saved list, where the logo itself says nothing to a screen reader. */
const KIND_LABEL: Record<DbKind, TranslationKey> = {
  mysql: "connection.kindMysql",
  postgres: "connection.kindPostgres",
  mongo: "connection.kindMongo",
  redis: "connection.kindRedis",
};

/**
 * The engines the shared SQL workspace can be opened on — the one place a kind is turned into the
 * pair of things everything below the workspace works through.
 *
 * A kind that is in here is a SQL kind — {@link isSqlKind} is read off this map — so adding an
 * engine is this entry and nothing else.
 */
const SQL_ENGINES = {
  mysql: { api: mysqlApi, dialect: mysqlDialect },
  postgres: { api: postgresApi, dialect: postgresDialect },
} as const satisfies Partial<Record<DbKind, { api: SqlApi; dialect: SqlDialect }>>;

type SqlKind = keyof typeof SQL_ENGINES;

/** Whether this kind opens the SQL workspace, and — to TypeScript — which of them it is. */
function isSqlKind(kind: DbKind): kind is SqlKind {
  return kind in SQL_ENGINES;
}

// Key order isn't stable across sources (object literals vs. values that
// round-tripped through the Tauri store's JSON), so a plain JSON.stringify
// comparison would flag identical configs as different. Sort keys
// recursively — and drop `undefined` props, matching JSON.stringify's own
// behavior — to get an order-independent snapshot instead.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

// The Mongo form is a single connection string, so the two things the rest of the app used to
// read off separate fields — the host for a tab title, the database to open first — have to be
// picked back out of it. Both are cosmetic: an unparseable string yields nothing and the
// connection itself still reports the real error.
// Split by hand rather than with `new URL`: a comma-separated seed list —
// `mongodb://a:27017,b:27017/?replicaSet=rs0` — is a perfectly good Mongo string but not a valid
// URL, and that shape is exactly the one a replica set is written in.
const MONGO_URI_RE = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]*)(?:\/([^?]*))?/i;

/** Host only — the string itself carries the password, which must never reach a tab title. */
function mongoUriHost(uri: string): string {
  return MONGO_URI_RE.exec(uri.trim())?.[1] ?? "";
}

/** The default database, i.e. the path segment in `mongodb://host/thisOne?options`. */
function mongoUriDatabase(uri: string): string {
  const path = MONGO_URI_RE.exec(uri.trim())?.[2] ?? "";
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Whether dialling `host` means talking to this machine — the one case a server refusing everything
 * but loopback is happy with. The whole `127.0.0.0/8` block counts, not just `127.0.0.1`, and IPv6
 * writes its loopback either bare or in the brackets a host field may still carry.
 */
function isLoopback(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    name === "localhost" ||
    name === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(name)
  );
}

/** Fixed width, not the value's own: the length of a password is itself worth not showing. */
const MASK = "****";

/** The `user:password@` prefix, i.e. everything the string reveals about credentials. */
const MONGO_URI_CREDENTIALS_RE = /^(mongodb(?:\+srv)?:\/\/)([^@/?]+)@/i;

/**
 * What the field shows while hidden. Only the credentials are covered, so the host and options
 * stay readable — those are what you check a connection against at a glance. A string with no
 * credentials in it isn't therefore safe to show: it may be one this app never parsed as Mongo at
 * all, so nothing in it is known to be harmless and the whole value is covered instead.
 */
function maskMongoUri(uri: string): string {
  if (!uri) return "";
  const credentials = MONGO_URI_CREDENTIALS_RE.exec(uri);
  if (!credentials) return MASK;
  const [full, scheme, userinfo] = credentials;
  // `user:password`, `user` alone, and the empty-password `user:` all mask one part per segment.
  const masked = userinfo
    .split(":")
    .map(() => MASK)
    .join(":");
  return `${scheme}${masked}@${uri.slice(full.length)}`;
}

/**
 * An example key path written the way the host OS writes one — a Windows path is no help to
 * someone looking for `~/.ssh` on a Mac. It stays out of the dictionaries because a path is not
 * language: it follows the machine the app runs on, not the language it was asked to speak.
 *
 * Which machine this is comes from {@link ../../platform}. Linux is the fallback rather than a third
 * test: WebKitGTK spells its system several ways (`X11`, `Wayland`, `Linux`), and every remaining
 * desktop puts home directories under `/home`.
 */
const PRIVATE_KEY_PLACEHOLDER = IS_WINDOWS
  ? "C:\\Users\\you\\.ssh\\id_rsa"
  : IS_MAC
    ? "/Users/you/.ssh/id_rsa"
    : "/home/you/.ssh/id_rsa";

/**
 * What the tunnel test is currently saying. The tone travels beside the sentence rather than being
 * read back out of it: the three messages are translated, so the text itself can't be matched on.
 */
interface TunnelStatus {
  tone: "pending" | "ok" | "error";
  message: string;
}

function DbTab({ active, onTitleChange, onBadgesChange, restored, onStateChange }: ModuleTabProps) {
  const { t, lang } = useTranslation();
  const [kind, setKind] = useState<DbKind>("mysql");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(DEFAULT_PORTS.mysql);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [uri, setUri] = useState("");
  // A connection string is only editable once shown, and showing it puts a password on screen —
  // so an empty one starts open (there is nothing to protect yet) and a saved one starts hidden.
  const [uriRevealed, setUriRevealed] = useState(true);
  const [confirmingReveal, setConfirmingReveal] = useState(false);
  // Off to start with: a new connection is most often to a local or tunnelled server, where SSL
  // buys nothing and an old server's TLS config is one more thing to fail on. A saved connection
  // brings its own answer.
  const [useSsl, setUseSsl] = useState(false);

  const [tunnelType, setTunnelType] = useState<"direct" | "ssh">("direct");
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState(22);
  const [sshUser, setSshUser] = useState("");
  const [sshAuthType, setSshAuthType] = useState<"password" | "privatekey">("password");
  const [sshPassword, setSshPassword] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [sshPassphrase, setSshPassphrase] = useState("");

  const savedConnections = useSavedConnections();
  const [saveAsName, setSaveAsName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const [connectionId, setConnectionId] = useState<string | null>(null);
  /* What this tab was connected to last launch, taken once. A snapshot and not a live read: the
     moment this tab connects it writes a new value, and reading that back would be the tab
     restoring itself from itself. */
  const [restoredState] = useState(() => parseDbTabState(restored));
  const savedConnectionsLoaded = useSavedConnectionsLoaded();
  /** Whether the restore below has had its one turn — win or lose. Without it, another tab saving
   *  a connection publishes a new list, the effect runs again, and this tab opens a second
   *  connection to the same server. */
  const restoreTried = useRef(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null);

  // Closing a tab unmounts this component, and the backend has no other way of hearing about it:
  // without this the pool (and the SSH tunnel behind it) would stay open in `AppState` until the
  // app itself is quit, one leaked connection per tab ever opened.
  //
  // Read through a ref so the effect can depend on nothing and therefore only ever run its cleanup
  // on a real unmount — depending on `connectionId` would disconnect on every change of it, which
  // includes the moment a connection is established.
  const connectionIdRef = useRef<string | null>(null);
  useEffect(() => {
    connectionIdRef.current = connectionId;
  }, [connectionId]);
  useEffect(
    () => () => {
      const id = connectionIdRef.current;
      // Nothing is left to show an error to, and a connection the backend has already forgotten is
      // not a failure worth reporting anywhere.
      if (id) invoke("disconnect_db", { id }).catch(() => {});
    },
    [],
  );

  /**
   * Whether the tab bar should be showing a lock for this tab.
   *
   * Only once connected: before that the mark belongs to the row in the sidebar, and the form on
   * screen may be for another connection entirely. Read off the store rather than remembered from
   * the click, so clearing the flag in one tab takes the lock off this one too.
   */
  const activeReadOnly = Boolean(
    connectionId && savedConnections.find((c) => c.id === editingId)?.readOnly,
  );

  /**
   * The marks this tab asks the tab bar for: the engine's logo, and the lock when the connection
   * behind it is read-only.
   *
   * The shell is told what to draw rather than what this tab is — it has no `DbKind` and no notion
   * of read-only. Which marks a given state calls for is {@link dbBadgeMarks}; turning them into
   * icons and sentences is here, because this is the side that has a `t`.
   */
  const badges = useMemo<TabBadge[]>(
    () =>
      dbBadgeMarks(connectionId ? kind : undefined, activeReadOnly).map((mark) =>
        mark.type === "kind"
          ? {
              id: "kind",
              // The same logo the sidebar row carries, without the tinted tile around it: a tab has
              // no room for a badge, and the mark alone is what has to be recognised.
              icon: <DatabaseIcon kind={mark.kind} size={14} />,
              label: t(KIND_LABEL[mark.kind]),
              className: `tab-kind kind-${mark.kind}`,
            }
          : {
              id: "readOnly",
              icon: <LockIcon size={12} />,
              label: t("common.readOnly"),
              title: t("common.readOnlyConnection"),
              className: "tab-lock",
              // The bar along the top of the open tab goes amber, which is the one thing on screen
              // that says so no matter which pane of the workspace is showing.
              tabClassName: "tab-readonly",
            },
      ),
    [connectionId, kind, activeReadOnly, t],
  );
  useEffect(() => {
    onBadgesChange(badges);
  }, [badges]);

  function changeKind(next: DbKind) {
    setKind(next);
    setPort(DEFAULT_PORTS[next]);
  }

  async function browseForPrivateKey() {
    const path = await open({
      title: t("connection.selectPrivateKeyDialogTitle"),
      multiple: false,
      directory: false,
    });
    if (typeof path === "string") {
      setSshKeyPath(path);
    }
  }

  function buildSshConfig(): SshConfig | undefined {
    if (tunnelType !== "ssh") return undefined;
    return {
      host: sshHost,
      port: sshPort,
      username: sshUser,
      auth:
        sshAuthType === "password"
          ? { type: "password", password: sshPassword }
          : {
              type: "privatekey",
              key_path: sshKeyPath,
              passphrase: sshPassphrase || undefined,
            },
    };
  }

  /**
   * Wipes everything the form is saying back to the user. Each message is about the connection that
   * was in the form when it appeared — a failed connect, a tunnel test — so loading a different one
   * leaves it describing something that is no longer on screen.
   */
  function clearFeedback() {
    setError("");
    setStatus("");
    setTunnelStatus(null);
  }

  function applySavedConnection(entry: SavedConnection) {
    const c = entry.config;
    setKind(c.kind);
    setHost(c.host);
    setPort(c.port);
    setUsername(c.username ?? "");
    setPassword(c.password ?? "");
    setDatabase(c.database ?? "");
    setUri(c.uri ?? "");
    setUriRevealed(!c.uri);
    setConfirmingReveal(false);
    setUseSsl(c.use_ssl ?? true);
    setTunnelType(c.ssh ? "ssh" : "direct");
    setSshHost("");
    setSshPort(22);
    setSshUser("");
    setSshAuthType("password");
    setSshPassword("");
    setSshKeyPath("");
    setSshPassphrase("");
    if (c.ssh) {
      setSshHost(c.ssh.host);
      setSshPort(c.ssh.port);
      setSshUser(c.ssh.username);
      setSshAuthType(c.ssh.auth.type);
      if (c.ssh.auth.type === "password") {
        setSshPassword(c.ssh.auth.password);
      } else {
        setSshKeyPath(c.ssh.auth.key_path);
        setSshPassphrase(c.ssh.auth.passphrase ?? "");
      }
    }
    setEditingId(entry.id);
    setSaveAsName(entry.name);
    setSavedSnapshot(stableStringify({ name: entry.name, config: entry.config }));
    clearFeedback();
    onTitleChange(entry.name);
  }

  function newConnectionForm() {
    setEditingId(null);
    setSaveAsName("");
    setSavedSnapshot(null);
    setKind("mysql");
    setHost("127.0.0.1");
    setPort(DEFAULT_PORTS.mysql);
    setUsername("");
    setPassword("");
    setDatabase("");
    setUri("");
    setUriRevealed(true);
    setConfirmingReveal(false);
    setUseSsl(false);
    setTunnelType("direct");
    setSshHost("");
    setSshPort(22);
    setSshUser("");
    setSshAuthType("password");
    setSshPassword("");
    setSshKeyPath("");
    setSshPassphrase("");
    clearFeedback();
    onTitleChange(t("app.newConnectionTitle"));
  }

  const isMongo = kind === "mongo";

  /* A Redis server whose default user has no password runs in protected mode unless it was told
     otherwise, and protected mode answers anything that isn't loopback with `-DENIED` and hangs
     up. The client only finds out when its next write hits the closed socket, so the tab reports
     a broken pipe and says nothing about why — hence the warning up here, where it can still be
     acted on.
     The tunnel doesn't come into it: this host is the address whoever dials Redis uses — this
     machine directly, or the SSH server on its behalf — so a loopback address means Redis is on
     the dialling machine either way, and anything else means it is not. */
  const showRedisProtectedModeHint =
    kind === "redis" && password === "" && !isLoopback(host);

  function buildConnectionConfig(): ConnectionConfig {
    return {
      kind,
      host,
      port,
      // Mongo takes its endpoint, credentials and default database from the connection string,
      // so the per-field values are left out entirely rather than saved as dead weight.
      username: isMongo ? undefined : username || undefined,
      password: isMongo ? undefined : password || undefined,
      database: isMongo ? undefined : database || undefined,
      uri: isMongo ? uri.trim() || undefined : undefined,
      ssh: buildSshConfig(),
      use_ssl: isSqlKind(kind) ? useSsl : undefined,
    };
  }

  async function saveConnection() {
    const name = saveAsName.trim();
    if (!name) return;
    if (editingId) {
      // Everything the entry carries that the form doesn't — whether it is pinned, the sidebar
      // width, Redis's scan limit — is kept: saving a connection edits its settings, it doesn't
      // reset the rest of what is remembered about it.
      const existing = savedConnections.find((c) => c.id === editingId);
      const config = buildConnectionConfig();
      const entry: SavedConnection = {
        ...existing,
        id: editingId,
        name,
        config,
      };
      await updateConnection(entry);
      setSavedSnapshot(stableStringify({ name: entry.name, config: entry.config }));
    } else {
      const entry: SavedConnection = {
        id: crypto.randomUUID(),
        name,
        config: buildConnectionConfig(),
      };
      await addConnection(entry);
      setEditingId(entry.id);
      setSavedSnapshot(stableStringify({ name: entry.name, config: entry.config }));
    }
  }

  async function saveConnectionAsNew() {
    const name = saveAsName.trim();
    if (!name) return;
    const entry: SavedConnection = {
      id: crypto.randomUUID(),
      name,
      config: buildConnectionConfig(),
    };
    await addConnection(entry);
    setEditingId(entry.id);
    setSavedSnapshot(stableStringify({ name: entry.name, config: entry.config }));
  }

  async function deleteSavedConnection(id: string) {
    await removeConnection(id);
    if (editingId === id) {
      newConnectionForm();
    }
  }

  async function duplicateSavedConnection(id: string) {
    const source = savedConnections.find((c) => c.id === id);
    if (!source) return;
    const entry: SavedConnection = {
      id: crypto.randomUUID(),
      name: `${source.name} (copy)`,
      config: source.config,
      // Carried over, unlike `pinned`: a copy of a production connection points at the same
      // server, so the mark that says not to write to it has to come along. Losing it would
      // turn "duplicate" into the one click that makes a read-only connection writable.
      readOnly: source.readOnly,
    };
    await addConnection(entry);
  }

  async function togglePinned(id: string) {
    const entry = savedConnections.find((c) => c.id === id);
    if (!entry) return;
    // Unpinning drops the flag rather than writing `false`: absent is the default, so a connection
    // that was pinned once doesn't carry a dead `"pinned": false` in the file forever.
    await updateConnection({ ...entry, pinned: entry.pinned ? undefined : true });
  }

  async function toggleReadOnly(id: string) {
    const entry = savedConnections.find((c) => c.id === id);
    if (!entry) return;
    // Dropped rather than written as `false`, for the same reason `pinned` is.
    await updateConnection({ ...entry, readOnly: entry.readOnly ? undefined : true });
  }

  /**
   * The list as the sidebar shows it: pinned first, alphabetical within each half.
   *
   * Sorted for display only — what is on disk keeps the order it was written in, so renaming a
   * connection doesn't rewrite the file's shape. `Intl.Collator` rather than comparing strings
   * with `<`: it files accented names beside their plain spelling instead of after every
   * unaccented one, orders `db2` before `db10`, and follows the language the app is set to.
   */
  const orderedConnections = useMemo(() => {
    const collator = new Intl.Collator(lang, { sensitivity: "base", numeric: true });
    return [...savedConnections].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return collator.compare(a.name, b.name);
    });
  }, [savedConnections, lang]);

  function openContextMenu(e: React.MouseEvent, id: string) {
    e.preventDefault();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  /**
   * Whether the SSH fields hold enough for a test to mean anything. Everything the chosen auth
   * method needs and nothing it doesn't: a passphrase belongs to a key that was encrypted, and an
   * unencrypted one has none, so it is never required. A test without these would only come back
   * with the server's own complaint about a missing host or user, one round trip later.
   */
  const sshInputsComplete =
    sshHost.trim() !== "" &&
    sshUser.trim() !== "" &&
    sshPort > 0 &&
    (sshAuthType === "password" ? sshPassword !== "" : sshKeyPath.trim() !== "");

  async function testTunnel() {
    setTunnelStatus({ tone: "pending", message: t("connection.testingTunnel") });
    const ssh = buildSshConfig();
    if (!ssh) {
      setTunnelStatus(null);
      return;
    }
    try {
      await invoke("test_ssh_tunnel", { ssh });
      setTunnelStatus({ tone: "ok", message: t("connection.tunnelOk") });
    } catch (e) {
      setTunnelStatus({ tone: "error", message: t("connection.tunnelFailed", { error: errorMessage(t, e) }) });
    }
  }

  /**
   * Opens the connection and puts the workspace on screen.
   *
   * `savedId` is a parameter and not a read of `editingId` on purpose: `openAndConnect` applies
   * the saved connection to the form and calls this in the same tick, so `setEditingId` has not
   * taken effect and this closure still sees whatever was there before. Passing it in is also what
   * makes the hand-typed branch say `undefined` deliberately rather than by omission.
   */
  async function connect(overrideConfig?: ConnectionConfig, title?: string, savedId?: string) {
    setError("");
    setStatus(t("connection.connecting"));
    const config = overrideConfig ?? buildConnectionConfig();
    try {
      const id = await invoke<string>("connect_db", { config });
      setConnectionId(id);
      /* Written on both branches, so where this tab points does not depend on `disconnect` having
         run first: connecting to something else replaces it, and connecting to a config nobody
         saved clears it. An id and nothing else — see `tabState.ts`. */
      onStateChange(savedId === undefined ? undefined : { savedId });
      setStatus(t("connection.connectedStatus", { id: id.slice(0, 8) }));
      const titleHost = config.kind === "mongo" ? mongoUriHost(config.uri ?? "") : config.host;
      onTitleChange(
        title ?? (saveAsName.trim() || t("connection.fallbackTitle", { kind: config.kind, host: titleHost })),
      );
    } catch (e) {
      /* The state is left alone. A server that is off, or a VPN that is not up, is not the user
         having moved away from that connection — the banner says so and the tab still points
         where it pointed. */
      setStatus("");
      setError(errorMessage(t, e));
    }
  }

  function openAndConnect(entry: SavedConnection) {
    applySavedConnection(entry);
    connect(entry.config, entry.name, entry.id);
  }

  /* The tab coming back to what it had open, once, the first time it is looked at — which for a
     tab restored from the last session is the first time it is mounted at all.
     `savedConnectionsLoaded` is the whole reason this waits: the list is empty until the file has
     been read, and acting on it before then would read "the connection was deleted" every launch.
     A connection that really has gone leaves the form as it opens, with no banner — nothing failed.
     `openAndConnect` is deliberately not a dependency; it is rebuilt every render. */
  useEffect(() => {
    if (restoreTried.current || restoredState === null || !savedConnectionsLoaded) return;
    restoreTried.current = true;
    const entry = savedConnections.find((c) => c.id === restoredState.savedId);
    if (entry !== undefined) openAndConnect(entry);
  }, [restoredState, savedConnectionsLoaded, savedConnections]);

  async function updateSidebarWidth(width: number) {
    if (!editingId) return;
    const entry = savedConnections.find((c) => c.id === editingId);
    if (!entry || entry.sidebarWidth === width) return;
    await updateConnection({ ...entry, sidebarWidth: width });
  }

  async function updateRedisScanLimit(limit: number) {
    if (!editingId) return;
    const entry = savedConnections.find((c) => c.id === editingId);
    if (!entry || entry.redisScanLimit === limit) return;
    await updateConnection({ ...entry, redisScanLimit: limit });
  }

  /**
   * Leave this connection: the workspace goes, the form comes back.
   *
   * The form comes back holding this same connection, and the sidebar still has it marked — the
   * one thing not cleared here is `editingId`. So the way back in is Connect, not finding it in
   * the list again, which is what makes this reversible enough to reach from a tab strip.
   *
   * The backend is told and not listened to, the same bargain the unmount above strikes: a
   * connection it has already forgotten is not a reason to keep a dead workspace on screen, and
   * leaving was the user's decision rather than a request that can be refused.
   */
  async function disconnect() {
    if (!connectionId) return;
    await invoke("disconnect_db", { id: connectionId }).catch(() => {});
    setConnectionId(null);
    // Leaving a connection is the one thing that means "do not come back here".
    onStateChange(undefined);
    setStatus("");
    /* Named after what the form is holding, which is what every other tab in the app is named
       after and what disconnecting has not changed: the saved connection is still loaded, still
       marked in the sidebar, and Connect is still all it takes to go back in. A tab that renamed
       itself "New Connection" over the top of that was the one thing on screen disagreeing with
       the rest of it. The entry's name and not the name box, which may be holding an edit nobody
       has saved — that has not renamed the connection, only proposed a new name for it.

       Nothing saved is loaded when a connection was typed in by hand, and then the form really
       is a new one and says so. */
    const entry = savedConnections.find((c) => c.id === editingId);
    onTitleChange(entry?.name ?? t("app.newConnectionTitle"));
  }

  const connectionForm = (
    <>
      <div className="row row-name">
        <label className="field-name">
          {editingId ? t("connection.nameLabel") : t("connection.saveAsLabel")}{" "}
          <Input
            value={saveAsName}
            onChange={(e) => setSaveAsName(e.target.value)}
            placeholder={t("connection.connectionNamePlaceholder")}
          />
        </label>
      </div>

      <fieldset>
        <legend>{t("connection.databaseLegend")}</legend>
        <div className="method-tabs" role="tablist">
          {(["mysql", "postgres", "mongo", "redis"] as DbKind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={`method-tab kind-${k}${kind === k ? " method-tab-active" : ""}`}
              onClick={() => changeKind(k)}
            >
              {/* Logo before the name, not instead of it: the tabs are the one place the kinds are
                  read side by side, so the word stays and the mark only makes it quicker to find. */}
              <DatabaseIcon kind={k} className="method-tab-icon" size="1.05em" />
              {t(KIND_LABEL[k])}
            </button>
          ))}
        </div>
        {isMongo ? (
          <div className="row">
            <label className="field-connection-string">
              {t("connection.connectionStringLabel")}{" "}
              <Input
                value={uriRevealed ? uri : maskMongoUri(uri)}
                onChange={(e) => setUri(e.target.value)}
                placeholder={t("connection.connectionStringPlaceholder")}
                readOnly={!uriRevealed}
              />
              <Button
                className="reveal-toggle"
                aria-pressed={uriRevealed}
                title={uriRevealed ? t("connection.hideConnectionString") : t("connection.revealConnectionString")}
                onClick={() => (uriRevealed ? setUriRevealed(false) : setConfirmingReveal(true))}
              >
                {/* The struck-through eye marks the state the button moves *to*: shown now,
                    click to hide. */}
                {uriRevealed ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </Button>
            </label>
          </div>
        ) : (
          /* One row for the whole endpoint: each field is held to half the width, so they pair
             themselves off two to a line — host and port, then the credentials, then the
             database on a line of its own. */
          <div className="row">
            <label>
              {t("common.host")}{" "}
              <Input value={host} onChange={(e) => setHost(e.target.value)} />
            </label>
            <label>
              {t("common.port")}{" "}
              <Input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
              />
            </label>
            <label>
              {t("common.user")}{" "}
              <Input value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label>
              {t("common.password")}{" "}
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label>
              {kind === "redis" ? t("connection.dbIndexLabel") : t("common.database")}{" "}
              <Input value={database} onChange={(e) => setDatabase(e.target.value)} />
            </label>
          </div>
        )}

        {showRedisProtectedModeHint && (
          <p className="field-warning" role="status">
            {t("connection.redisNoPasswordWarning")}
          </p>
        )}

        {isSqlKind(kind) && (
          <div className="row">
            <label>
              <input type="checkbox" checked={useSsl} onChange={(e) => setUseSsl(e.target.checked)} />{" "}
              {t("connection.useSslLabel")}
            </label>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>{t("connection.connectionMethodLegend")}</legend>
        <div className="method-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tunnelType === "direct"}
            className={`method-tab${tunnelType === "direct" ? " method-tab-active" : ""}`}
            onClick={() => setTunnelType("direct")}
          >
            {t("connection.methodTcpIp")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tunnelType === "ssh"}
            className={`method-tab${tunnelType === "ssh" ? " method-tab-active" : ""}`}
            onClick={() => setTunnelType("ssh")}
          >
            {t("connection.methodSsh")}
          </button>
        </div>
        {tunnelType === "ssh" && (
          <>
            <div className="row">
              <label>
                {t("connection.sshHost")}{" "}
                <Input value={sshHost} onChange={(e) => setSshHost(e.target.value)} />
              </label>
              <label>
                {t("connection.sshPort")}{" "}
                <Input
                  type="number"
                  value={sshPort}
                  onChange={(e) => setSshPort(Number(e.target.value))}
                />
              </label>
              <label>
                {t("connection.sshUser")}{" "}
                <Input value={sshUser} onChange={(e) => setSshUser(e.target.value)} />
              </label>
              <label>
                {t("connection.auth")}{" "}
                <Select
                  value={sshAuthType}
                  onChange={(v) => setSshAuthType(v)}
                  options={[
                    { value: "password", label: t("connection.authPassword") },
                    { value: "privatekey", label: t("connection.authPrivateKey") },
                  ]}
                />
              </label>
            </div>
            {sshAuthType === "password" && (
              <div className="row">
                <label>
                  {t("connection.sshPassword")}{" "}
                  <Input
                    type="password"
                    value={sshPassword}
                    onChange={(e) => setSshPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
              </div>
            )}
            {sshAuthType === "privatekey" && (
              <div className="row">
                <label>
                  {t("connection.privateKeyFile")}{" "}
                  <Input
                    value={sshKeyPath}
                    onChange={(e) => setSshKeyPath(e.target.value)}
                    placeholder={PRIVATE_KEY_PLACEHOLDER}
                  />
                </label>
                <Button onClick={browseForPrivateKey}>
                  {t("common.browse")}
                </Button>
                <label>
                  {t("connection.keyPassphrase")}{" "}
                  <Input
                    type="password"
                    value={sshPassphrase}
                    onChange={(e) => setSshPassphrase(e.target.value)}
                    placeholder={t("connection.passphrasePlaceholder")}
                    autoComplete="new-password"
                  />
                </label>
              </div>
            )}
            <div className="row">
              <Button onClick={testTunnel} disabled={!sshInputsComplete}>
                {t("connection.testTunnel")}
              </Button>
              {tunnelStatus && (
                <span className={`tunnel-status tunnel-status-${tunnelStatus.tone}`}>{tunnelStatus.message}</span>
              )}
            </div>
          </>
        )}
      </fieldset>

      <div className="row row-actions">
        <div className="row-actions-left">
          <Button
            onClick={saveConnection}
            disabled={
              !saveAsName.trim() ||
              (editingId !== null &&
                savedSnapshot === stableStringify({ name: saveAsName.trim(), config: buildConnectionConfig() }))
            }
          >
            {editingId ? t("connection.updateConnection") : t("connection.saveConnection")}
          </Button>
          {editingId && (
            <Button onClick={saveConnectionAsNew} disabled={!saveAsName.trim()}>
              {t("connection.saveAsNew")}
            </Button>
          )}
        </div>
        <div className="row-actions-right">
          <span>{status}</span>
          <Button variant="primary" onClick={() => connect()}>
            {t("common.connect")}
          </Button>
        </div>
      </div>

      {confirmingReveal && (
        <ConfirmDialog
          title={t("connection.revealConnectionStringTitle")}
          message={t("connection.revealConnectionStringMessage")}
          confirmLabel={t("connection.revealConnectionStringConfirm")}
          onConfirm={() => {
            setUriRevealed(true);
            setConfirmingReveal(false);
          }}
          onCancel={() => setConfirmingReveal(false)}
        />
      )}
    </>
  );

  if (!connectionId) {
    return (
      <div className="login-view">
        <aside className="saved-list">
          <div className="saved-list-header">
            <h3>{t("connection.connections")}</h3>
            {/* Creating a connection is an action on the list, not one of its rows, so it sits in
                the header where it stays reachable however far the names scroll. */}
            <button
              type="button"
              className="saved-list-new"
              onClick={newConnectionForm}
              title={t("connection.newConnection")}
            >
              <span className="saved-item-icon kind-new">+</span>
              <span className="visually-hidden">{t("connection.newConnection")}</span>
            </button>
          </div>
          <ul>
            {orderedConnections.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`saved-item${c.id === editingId ? " saved-item-active" : ""}${
                    c.readOnly ? " saved-item-readonly" : ""
                  }`}
                  onClick={() => applySavedConnection(c)}
                  onDoubleClick={() => openAndConnect(c)}
                  onContextMenu={(e) => openContextMenu(e, c.id)}
                  title={t("connection.savedItemTooltip")}
                >
                  {/* The engine's own logo, in its own colour: the row is recognised by a shape
                      the user already knows from everywhere else, rather than by an abbreviation
                      this app made up. The name it stands for is carried in text beside it for
                      anyone the shape says nothing to. */}
                  <span className={`saved-item-icon kind-${c.config.kind}`}>
                    <DatabaseIcon kind={c.config.kind} size="1.05rem" />
                    <span className="visually-hidden">{t(KIND_LABEL[c.config.kind])}</span>
                  </span>
                  <strong>{c.name}</strong>
                  {/* Read-only is about what the row will let you do, so it says the word rather
                      than only drawing a lock — a shape alone would be one more badge to learn.
                      The row carries the mark's colour too, so a production server is recognisable
                      before the eye reaches the end of its name. */}
                  {c.readOnly && (
                    <span className="saved-item-readonly-badge">
                      <LockIcon size={12} />
                      {t("common.readOnly")}
                    </span>
                  )}
                  {/* Says why this one sits above the alphabet. The button's own `title` describes
                      the row, so the mark carries its word in a `<span>` for screen readers
                      rather than in a second tooltip that would replace it. */}
                  {c.pinned && (
                    <span className="saved-item-pin">
                      <PinIcon size={14} />
                      <span className="visually-hidden">{t("connection.pinnedTooltip")}</span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="login-form">
          {connectionForm}
          {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
        </section>
        {contextMenu && (
          <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={closeContextMenu}>
            <button
              type="button"
              onClick={() => {
                togglePinned(contextMenu.id);
                closeContextMenu();
              }}
            >
              {savedConnections.find((c) => c.id === contextMenu.id)?.pinned
                ? t("connection.unpin")
                : t("connection.pin")}
            </button>
            {/* Offered whatever the kind: each workspace closes off everything of its own that
                would write, so the flag means the same thing on a Mongo or Redis connection as it
                does on a MySQL one. */}
            <button
              type="button"
              onClick={() => {
                toggleReadOnly(contextMenu.id);
                closeContextMenu();
              }}
            >
              {savedConnections.find((c) => c.id === contextMenu.id)?.readOnly
                ? t("connection.allowWrites")
                : t("connection.markReadOnly")}
            </button>
            <button
              type="button"
              onClick={() => {
                duplicateSavedConnection(contextMenu.id);
                closeContextMenu();
              }}
            >
              {t("common.duplicate")}
            </button>
            <button
              type="button"
              className="context-menu-delete"
              onClick={() => {
                deleteSavedConnection(contextMenu.id);
                closeContextMenu();
              }}
            >
              {t("common.delete")}
            </button>
          </ContextMenu>
        )}
      </div>
    );
  }

  if (isSqlKind(kind)) {
    const activeSavedConnection = savedConnections.find((c) => c.id === editingId);
    // The one place the engine behind a SQL workspace is chosen. Everything below reaches for it
    // through the context rather than importing an engine of its own — see `src/sql/context.tsx`.
    const engine = SQL_ENGINES[kind];
    return (
      <SqlProvider api={engine.api} dialect={engine.dialect}>
        <SqlWorkspace
          active={active}
          connectionId={connectionId}
          initialDatabase={database}
          status={status}
          error={error}
          tunnelled={tunnelType === "ssh"}
          onDisconnect={disconnect}
          sidebarWidth={activeSavedConnection?.sidebarWidth}
          onSidebarWidthChange={updateSidebarWidth}
          readOnly={activeSavedConnection?.readOnly ?? false}
          profileId={activeSavedConnection?.id ?? ""}
        />
      </SqlProvider>
    );
  }

  if (kind === "mongo") {
    const activeSavedConnection = savedConnections.find((c) => c.id === editingId);
    return (
      <MongoWorkspace
        active={active}
        connectionId={connectionId}
        initialDatabase={mongoUriDatabase(uri)}
        status={status}
        error={error}
        tunnelled={tunnelType === "ssh"}
        onDisconnect={disconnect}
        sidebarWidth={activeSavedConnection?.sidebarWidth}
        onSidebarWidthChange={updateSidebarWidth}
        readOnly={activeSavedConnection?.readOnly ?? false}
      />
    );
  }

  const activeSavedConnection = savedConnections.find((c) => c.id === editingId);
  return (
    <RedisWorkspace
      active={active}
      connectionId={connectionId}
      initialDatabase={database}
      status={status}
      error={error}
      tunnelled={tunnelType === "ssh"}
      onDisconnect={disconnect}
      sidebarWidth={activeSavedConnection?.sidebarWidth}
      onSidebarWidthChange={updateSidebarWidth}
      scanLimit={activeSavedConnection?.redisScanLimit}
      onScanLimitChange={updateRedisScanLimit}
      readOnly={activeSavedConnection?.readOnly ?? false}
    />
  );
}

export default DbTab;
