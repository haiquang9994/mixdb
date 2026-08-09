import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  addSavedConnection,
  loadSavedConnections,
  removeSavedConnection,
  updateSavedConnection,
} from "./savedConnections";
import { DEFAULT_PORTS, type ConnectionConfig, type DbKind, type SavedConnection, type SshConfig } from "./types";
import MysqlWorkspace from "./mysql/MysqlWorkspace";
import MongoWorkspace from "./mongo/MongoWorkspace";
import RedisWorkspace from "./redis/RedisWorkspace";
import Select from "./components/Select";
import ErrorBanner from "./components/ErrorBanner";
import ConfirmDialog from "./components/ConfirmDialog";
import Button from "./components/Button";
import Input from "./components/Input";
import { EyeIcon, EyeOffIcon } from "./icons";
import { useTranslation } from "./i18n";

interface Props {
  onTitleChange: (title: string) => void;
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

function ConnectionTab({ onTitleChange }: Props) {
  const { t } = useTranslation();
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
  const [useSsl, setUseSsl] = useState(true);

  const [tunnelType, setTunnelType] = useState<"direct" | "ssh">("direct");
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState(22);
  const [sshUser, setSshUser] = useState("");
  const [sshAuthType, setSshAuthType] = useState<"password" | "privatekey">("password");
  const [sshPassword, setSshPassword] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [sshPassphrase, setSshPassphrase] = useState("");

  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>([]);
  const [saveAsName, setSaveAsName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState("");

  useEffect(() => {
    loadSavedConnections().then(setSavedConnections);
  }, []);

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
    setTunnelStatus("");
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
    setUseSsl(true);
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
      const entry: SavedConnection = { id: editingId, name, config: buildConnectionConfig() };
      const next = await updateSavedConnection(entry);
      setSavedConnections(next);
      setSavedSnapshot(stableStringify({ name: entry.name, config: entry.config }));
    } else {
      const entry: SavedConnection = {
        id: crypto.randomUUID(),
        name,
        config: buildConnectionConfig(),
      };
      const next = await addSavedConnection(entry);
      setSavedConnections(next);
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
    const next = await addSavedConnection(entry);
    setSavedConnections(next);
    setEditingId(entry.id);
    setSavedSnapshot(stableStringify({ name: entry.name, config: entry.config }));
  }

  async function deleteSavedConnection(id: string) {
    const next = await removeSavedConnection(id);
    setSavedConnections(next);
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
    const next = await addSavedConnection(entry);
    setSavedConnections(next);
  }

  function openContextMenu(e: React.MouseEvent, id: string) {
    e.preventDefault();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  async function testTunnel() {
    setTunnelStatus(t("connection.testingTunnel"));
    const ssh = buildSshConfig();
    if (!ssh) {
      setTunnelStatus("");
      return;
    }
    try {
      await invoke("test_ssh_tunnel", { ssh });
      setTunnelStatus(t("connection.tunnelOk"));
    } catch (e) {
      setTunnelStatus(t("connection.tunnelFailed", { error: String(e) }));
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
      setError(String(e));
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
    const next = await updateSavedConnection({ ...entry, sidebarWidth: width });
    setSavedConnections(next);
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
            size="large"
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
                size="large"
                value={uriRevealed ? uri : maskMongoUri(uri)}
                onChange={(e) => setUri(e.target.value)}
                placeholder={t("connection.connectionStringPlaceholder")}
                readOnly={!uriRevealed}
              />
              <Button
                size="large"
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
          <>
            <div className="row">
              <label>
                {t("common.host")}{" "}
                <Input size="large" value={host} onChange={(e) => setHost(e.target.value)} />
              </label>
              <label>
                {t("common.port")}{" "}
                <Input
                  size="large"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </label>
            </div>
            <div className="row">
              <label>
                {t("common.user")}{" "}
                <Input size="large" value={username} onChange={(e) => setUsername(e.target.value)} />
              </label>
              <label>
                {t("common.password")}{" "}
                <Input
                  size="large"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label>
                {kind === "redis" ? t("connection.dbIndexLabel") : t("common.database")}{" "}
                <Input size="large" value={database} onChange={(e) => setDatabase(e.target.value)} />
              </label>
            </div>
          </>
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
                <Input size="large" value={sshHost} onChange={(e) => setSshHost(e.target.value)} />
              </label>
              <label>
                {t("connection.sshPort")}{" "}
                <Input
                  size="large"
                  type="number"
                  value={sshPort}
                  onChange={(e) => setSshPort(Number(e.target.value))}
                />
              </label>
              <label>
                {t("connection.sshUser")}{" "}
                <Input size="large" value={sshUser} onChange={(e) => setSshUser(e.target.value)} />
              </label>
              <label>
                {t("connection.auth")}{" "}
                <Select
                  value={sshAuthType}
                  onChange={(v) => setSshAuthType(v)}
                  size="large"
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
                    size="large"
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
                    size="large"
                    value={sshKeyPath}
                    onChange={(e) => setSshKeyPath(e.target.value)}
                    placeholder={t("connection.privateKeyPlaceholder")}
                  />
                </label>
                <Button size="large" onClick={browseForPrivateKey}>
                  {t("common.browse")}
                </Button>
                <label>
                  {t("connection.keyPassphrase")}{" "}
                  <Input
                    size="large"
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
              <Button size="large" onClick={testTunnel}>
                {t("connection.testTunnel")}
              </Button>
              <span>{tunnelStatus}</span>
            </div>
          </>
        )}
      </fieldset>

      <div className="row row-actions">
        <div className="row-actions-left">
          <Button
            size="large"
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
            <Button size="large" onClick={saveConnectionAsNew} disabled={!saveAsName.trim()}>
              {t("connection.saveAsNew")}
            </Button>
          )}
        </div>
        <div className="row-actions-right">
          <span>{status}</span>
          <Button size="large" onClick={() => connect()}>
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
          </div>
          <ul>
            <li>
              <button type="button" className="saved-item saved-item-new" onClick={newConnectionForm}>
                <span className="saved-item-icon kind-new">+</span>
                <strong>{t("connection.newConnection")}</strong>
              </button>
            </li>
            {savedConnections.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`saved-item${c.id === editingId ? " saved-item-active" : ""}`}
                  onClick={() => applySavedConnection(c)}
                  onDoubleClick={() => openAndConnect(c)}
                  onContextMenu={(e) => openContextMenu(e, c.id)}
                  title={t("connection.savedItemTooltip")}
                >
                  <span className={`saved-item-icon kind-${c.config.kind}`}>
                    {KIND_BADGE[c.config.kind]}
                  </span>
                  <strong>{c.name}</strong>
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
          <>
            <div className="context-menu-overlay" onClick={closeContextMenu} onContextMenu={(e) => e.preventDefault()} />
            <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
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
            </div>
          </>
        )}
      </div>
    );
  }

  if (kind === "mysql") {
    const activeSavedConnection = savedConnections.find((c) => c.id === editingId);
    return (
      <MysqlWorkspace
        connectionId={connectionId}
        initialDatabase={database}
        status={status}
        error={error}
        onDisconnect={disconnect}
        sidebarWidth={activeSavedConnection?.sidebarWidth}
        onSidebarWidthChange={updateSidebarWidth}
      />
    );
  }

  if (kind === "mongo") {
    const activeSavedConnection = savedConnections.find((c) => c.id === editingId);
    return (
      <MongoWorkspace
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
    />
  );
}

export default ConnectionTab;
