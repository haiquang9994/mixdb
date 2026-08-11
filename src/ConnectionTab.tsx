import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  addConnection,
  removeConnection,
  updateConnection,
  useSavedConnections,
} from "./savedConnectionsStore";
import { DEFAULT_PORTS, type ConnectionConfig, type DbKind, type SavedConnection, type SshConfig } from "./types";
import MysqlWorkspace from "./mysql/MysqlWorkspace";
import MongoWorkspace from "./mongo/MongoWorkspace";
import RedisWorkspace from "./redis/RedisWorkspace";
import Select from "./components/Select";
import ErrorBanner from "./components/ErrorBanner";
import ConfirmDialog from "./components/ConfirmDialog";
import ContextMenu from "./components/ContextMenu";
import Button from "./components/Button";
import Input from "./components/Input";
import { EyeIcon, EyeOffIcon, LockIcon, PinIcon } from "./icons";
import { useTranslation } from "./i18n";
import { errorMessage } from "./errors";

interface Props {
  /** Whether this is the tab the tab bar is showing. Every other one stays mounted behind it, so
   *  the panes below need telling which of them a keyboard shortcut is meant for. */
  active: boolean;
  onTitleChange: (title: string) => void;
  /** Whether the tab bar should mark this tab read-only. Reported rather than worked out up there:
   *  only this tab knows which saved connection it was opened from. */
  onReadOnlyChange: (readOnly: boolean) => void;
}

const KIND_BADGE: Record<DbKind, string> = {
  mysql: "SQL",
  mongo: "MDB",
  redis: "RDS",
};

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
 * Tauri renders in the platform's own webview, so the user agent names the platform. Linux is the
 * fallback rather than a third test: WebKitGTK spells its system several ways (`X11`, `Wayland`,
 * `Linux`), and every remaining desktop puts home directories under `/home`.
 */
const PRIVATE_KEY_PLACEHOLDER = navigator.userAgent.includes("Windows")
  ? "C:\\Users\\you\\.ssh\\id_rsa"
  : navigator.userAgent.includes("Mac OS X")
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

function ConnectionTab({ active, onTitleChange, onReadOnlyChange }: Props) {
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
  useEffect(() => {
    onReadOnlyChange(activeReadOnly);
  }, [activeReadOnly]);

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
      use_ssl: kind === "mysql" ? useSsl : undefined,
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
        // Read-only is the exception to that: only MySQL enforces it and only MySQL offers the menu
        // item that clears it, so a connection changed to another kind drops the flag rather than
        // keeping one nothing acts on and nothing can turn off.
        readOnly: config.kind === "mysql" ? existing?.readOnly : undefined,
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

  async function connect(overrideConfig?: ConnectionConfig, title?: string) {
    setError("");
    setStatus(t("connection.connecting"));
    const config = overrideConfig ?? buildConnectionConfig();
    try {
      const id = await invoke<string>("connect_db", { config });
      setConnectionId(id);
      setStatus(t("connection.connectedStatus", { id: id.slice(0, 8) }));
      const titleHost = config.kind === "mongo" ? mongoUriHost(config.uri ?? "") : config.host;
      onTitleChange(
        title ?? (saveAsName.trim() || t("connection.fallbackTitle", { kind: config.kind, host: titleHost })),
      );
    } catch (e) {
      setStatus("");
      setError(errorMessage(t, e));
    }
  }

  function openAndConnect(entry: SavedConnection) {
    applySavedConnection(entry);
    connect(entry.config, entry.name);
  }

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

  async function disconnect() {
    if (!connectionId) return;
    await invoke("disconnect_db", { id: connectionId });
    setConnectionId(null);
    setStatus("");
    onTitleChange(t("app.newConnectionTitle"));
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
          {(["mysql", "mongo", "redis"] as DbKind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={`method-tab${kind === k ? " method-tab-active" : ""}`}
              onClick={() => changeKind(k)}
            >
              {k === "mysql" ? t("connection.kindMysql") : k === "mongo" ? t("connection.kindMongo") : t("connection.kindRedis")}
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

        {kind === "mysql" && (
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
                  <span className={`saved-item-icon kind-${c.config.kind}`}>
                    {KIND_BADGE[c.config.kind]}
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
            {/* MySQL only: the Query tab is the one place that refuses a write, so offering the
                flag on a Mongo or Redis connection would promise a protection nothing keeps. */}
            {savedConnections.find((c) => c.id === contextMenu.id)?.config.kind === "mysql" && (
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
            )}
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

  if (kind === "mysql") {
    const activeSavedConnection = savedConnections.find((c) => c.id === editingId);
    return (
      <MysqlWorkspace
        active={active}
        connectionId={connectionId}
        initialDatabase={database}
        status={status}
        error={error}
        onDisconnect={disconnect}
        sidebarWidth={activeSavedConnection?.sidebarWidth}
        onSidebarWidthChange={updateSidebarWidth}
        readOnly={activeSavedConnection?.readOnly ?? false}
        profileId={activeSavedConnection?.id ?? ""}
      />
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
        onDisconnect={disconnect}
        sidebarWidth={activeSavedConnection?.sidebarWidth}
        onSidebarWidthChange={updateSidebarWidth}
      />
    );
  }

  const activeSavedConnection = savedConnections.find((c) => c.id === editingId);
  return (
    <RedisWorkspace
      connectionId={connectionId}
      initialDatabase={database}
      status={status}
      error={error}
      onDisconnect={disconnect}
      sidebarWidth={activeSavedConnection?.sidebarWidth}
      onSidebarWidthChange={updateSidebarWidth}
      scanLimit={activeSavedConnection?.redisScanLimit}
      onScanLimitChange={updateRedisScanLimit}
    />
  );
}

export default ConnectionTab;
