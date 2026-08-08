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
import Select from "./components/Select";
import ErrorBanner from "./components/ErrorBanner";
import Button from "./components/Button";

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

function ConnectionTab({ onTitleChange }: Props) {
  const [kind, setKind] = useState<DbKind>("mysql");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(DEFAULT_PORTS.mysql);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
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

  const [mongoCollection, setMongoCollection] = useState("");
  const [mongoFilter, setMongoFilter] = useState("{}");
  const [redisArgs, setRedisArgs] = useState("PING");

  const [rawResult, setRawResult] = useState("");

  useEffect(() => {
    loadSavedConnections().then(setSavedConnections);
  }, []);

  function changeKind(next: DbKind) {
    setKind(next);
    setPort(DEFAULT_PORTS[next]);
  }

  async function browseForPrivateKey() {
    const path = await open({
      title: "Select private key",
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

  function applySavedConnection(entry: SavedConnection) {
    const c = entry.config;
    setKind(c.kind);
    setHost(c.host);
    setPort(c.port);
    setUsername(c.username ?? "");
    setPassword(c.password ?? "");
    setDatabase(c.database ?? "");
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
    setError("");
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
    setUseSsl(true);
    setTunnelType("direct");
    setSshHost("");
    setSshPort(22);
    setSshUser("");
    setSshAuthType("password");
    setSshPassword("");
    setSshKeyPath("");
    setSshPassphrase("");
    setError("");
    setStatus("");
    onTitleChange("New Connection");
  }

  function buildConnectionConfig(): ConnectionConfig {
    return {
      kind,
      host,
      port,
      username: username || undefined,
      password: password || undefined,
      database: database || undefined,
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
    setTunnelStatus("Testing...");
    const ssh = buildSshConfig();
    if (!ssh) {
      setTunnelStatus("");
      return;
    }
    try {
      await invoke("test_ssh_tunnel", { ssh });
      setTunnelStatus("✓ Tunnel OK — SSH auth succeeded");
    } catch (e) {
      setTunnelStatus(`✗ ${String(e)}`);
    }
  }

  async function connect(overrideConfig?: ConnectionConfig, title?: string) {
    setError("");
    setStatus("Connecting...");
    const config = overrideConfig ?? buildConnectionConfig();
    try {
      const id = await invoke<string>("connect_db", { config });
      setConnectionId(id);
      setStatus(`Connected (${id.slice(0, 8)})`);
      onTitleChange(title ?? (saveAsName.trim() || `${config.kind} · ${config.host}`));
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
    setRawResult("");
    onTitleChange("New Connection");
  }

  async function runMongoFind() {
    if (!connectionId) return;
    setError("");
    try {
      const result = await invoke<unknown[]>("mongo_find", {
        id: connectionId,
        db: database,
        collection: mongoCollection,
        filter: mongoFilter,
        limit: 100,
      });
      setRawResult(JSON.stringify(result, null, 2));
    } catch (e) {
      setError(String(e));
    }
  }

  async function runRedisCommand() {
    if (!connectionId) return;
    setError("");
    try {
      const args = redisArgs.trim().split(/\s+/);
      const result = await invoke("redis_command", { id: connectionId, args });
      setRawResult(JSON.stringify(result, null, 2));
    } catch (e) {
      setError(String(e));
    }
  }

  const connectionForm = (
    <>
      <div className="row row-name">
        <label className="field-name">
          {editingId ? "Name" : "Save as"}{" "}
          <input
            value={saveAsName}
            onChange={(e) => setSaveAsName(e.target.value)}
            placeholder="Connection name"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </label>
      </div>

      <fieldset>
        <legend>Database</legend>
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
              {k === "mysql" ? "MySQL" : k === "mongo" ? "MongoDB" : "Redis"}
            </button>
          ))}
        </div>
        <div className="row">
          <label>
            Host{" "}
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>
          <label>
            Port{" "}
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              autoComplete="off"
            />
          </label>
        </div>
        <div className="row">
          <label>
            User{" "}
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>
          <label>
            Password{" "}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>
          <label>
            {kind === "redis" ? "DB index" : "Database"}{" "}
            <input
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>
        </div>

        {kind === "mysql" && (
          <div className="row">
            <label>
              <input type="checkbox" checked={useSsl} onChange={(e) => setUseSsl(e.target.checked)} />{" "}
              Use SSL (uncheck if the server has no/legacy SSL, e.g. old self-signed certs)
            </label>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>Connection method</legend>
        <div className="method-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tunnelType === "direct"}
            className={`method-tab${tunnelType === "direct" ? " method-tab-active" : ""}`}
            onClick={() => setTunnelType("direct")}
          >
            TCP/IP
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tunnelType === "ssh"}
            className={`method-tab${tunnelType === "ssh" ? " method-tab-active" : ""}`}
            onClick={() => setTunnelType("ssh")}
          >
            SSH
          </button>
        </div>
        {tunnelType === "ssh" && (
          <>
            <div className="row">
              <label>
                SSH host{" "}
                <input
                  value={sshHost}
                  onChange={(e) => setSshHost(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </label>
              <label>
                SSH port{" "}
                <input
                  type="number"
                  value={sshPort}
                  onChange={(e) => setSshPort(Number(e.target.value))}
                  autoComplete="off"
                />
              </label>
              <label>
                SSH user{" "}
                <input
                  value={sshUser}
                  onChange={(e) => setSshUser(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </label>
              <label>
                Auth{" "}
                <Select
                  value={sshAuthType}
                  onChange={(v) => setSshAuthType(v)}
                  options={[
                    { value: "password", label: "Password" },
                    { value: "privatekey", label: "Private key" },
                  ]}
                />
              </label>
            </div>
            {sshAuthType === "password" && (
              <div className="row">
                <label>
                  SSH password{" "}
                  <input
                    type="password"
                    value={sshPassword}
                    onChange={(e) => setSshPassword(e.target.value)}
                    autoComplete="new-password"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                </label>
              </div>
            )}
            {sshAuthType === "privatekey" && (
              <div className="row">
                <label>
                  Private key file{" "}
                  <input
                    value={sshKeyPath}
                    onChange={(e) => setSshKeyPath(e.target.value)}
                    placeholder="C:\Users\you\.ssh\id_rsa"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                </label>
                <Button size="large" onClick={browseForPrivateKey}>
                  Browse...
                </Button>
                <label>
                  Key passphrase{" "}
                  <input
                    type="password"
                    value={sshPassphrase}
                    onChange={(e) => setSshPassphrase(e.target.value)}
                    placeholder="(leave blank if none)"
                    autoComplete="new-password"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                </label>
              </div>
            )}
            <div className="row">
              <Button size="large" onClick={testTunnel}>
                Test tunnel
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
            {editingId ? "Update connection" : "Save connection"}
          </Button>
          {editingId && (
            <Button size="large" onClick={saveConnectionAsNew} disabled={!saveAsName.trim()}>
              Save as new
            </Button>
          )}
        </div>
        <div className="row-actions-right">
          <span>{status}</span>
          <Button size="large" onClick={() => connect()}>
            Connect
          </Button>
        </div>
      </div>
    </>
  );

  if (!connectionId) {
    return (
      <div className="login-view">
        <aside className="saved-list">
          <div className="saved-list-header">
            <h3>Connections</h3>
          </div>
          <ul>
            <li>
              <button type="button" className="saved-item saved-item-new" onClick={newConnectionForm}>
                <span className="saved-item-icon kind-new">+</span>
                <strong>New connection</strong>
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
                  title="Click to edit · double-click to connect · right-click for options"
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
                Duplicate
              </button>
              <button
                type="button"
                className="context-menu-delete"
                onClick={() => {
                  deleteSavedConnection(contextMenu.id);
                  closeContextMenu();
                }}
              >
                Delete
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

  return (
    <div className="workspace">
      <div className="row">
        <Button onClick={disconnect}>Disconnect</Button>
        <span>{status}</span>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      {kind === "mongo" && (
        <fieldset>
          <legend>Find</legend>
          <div className="row">
            <label>
              Collection{" "}
              <input
                value={mongoCollection}
                onChange={(e) => setMongoCollection(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </label>
          </div>
          <textarea
            rows={3}
            value={mongoFilter}
            onChange={(e) => setMongoFilter(e.target.value)}
            placeholder="{}"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <div className="row">
            <Button onClick={runMongoFind}>Find</Button>
          </div>
        </fieldset>
      )}

      {kind === "redis" && (
        <fieldset>
          <legend>Command</legend>
          <input
            value={redisArgs}
            onChange={(e) => setRedisArgs(e.target.value)}
            placeholder="GET mykey"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <div className="row">
            <Button onClick={runRedisCommand}>Execute</Button>
          </div>
        </fieldset>
      )}

      {rawResult && <pre className="result">{rawResult}</pre>}
    </div>
  );
}

export default ConnectionTab;
