import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  addSavedConnection,
  loadSavedConnections,
  removeSavedConnection,
} from "./savedConnections";
import { DEFAULT_PORTS, type ConnectionConfig, type DbKind, type SavedConnection, type SshConfig } from "./types";

interface Props {
  onTitleChange: (title: string) => void;
}

function ConnectionTab({ onTitleChange }: Props) {
  const [kind, setKind] = useState<DbKind>("mysql");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(DEFAULT_PORTS.mysql);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [useSsl, setUseSsl] = useState(true);

  const [useSsh, setUseSsh] = useState(false);
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState(22);
  const [sshUser, setSshUser] = useState("");
  const [sshAuthType, setSshAuthType] = useState<"password" | "privatekey">("password");
  const [sshPassword, setSshPassword] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [sshPassphrase, setSshPassphrase] = useState("");

  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>([]);
  const [saveAsName, setSaveAsName] = useState("");

  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState("");

  const [sql, setSql] = useState("SELECT 1");
  const [mongoCollection, setMongoCollection] = useState("");
  const [mongoFilter, setMongoFilter] = useState("{}");
  const [redisArgs, setRedisArgs] = useState("PING");

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
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
    if (!useSsh) return undefined;
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
    setUseSsh(!!c.ssh);
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
    onTitleChange(entry.name);
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

  async function saveCurrentConnection() {
    const name = saveAsName.trim();
    if (!name) return;
    const entry: SavedConnection = {
      id: crypto.randomUUID(),
      name,
      config: buildConnectionConfig(),
    };
    const next = await addSavedConnection(entry);
    setSavedConnections(next);
    setSaveAsName("");
  }

  async function deleteSavedConnection(id: string) {
    const next = await removeSavedConnection(id);
    setSavedConnections(next);
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

  async function connect() {
    setError("");
    setStatus("Connecting...");
    const config = buildConnectionConfig();
    try {
      const id = await invoke<string>("connect_db", { config });
      setConnectionId(id);
      setStatus(`Connected (${id.slice(0, 8)})`);
      onTitleChange(`${kind} · ${host}`);
    } catch (e) {
      setStatus("");
      setError(String(e));
    }
  }

  async function disconnect() {
    if (!connectionId) return;
    await invoke("disconnect_db", { id: connectionId });
    setConnectionId(null);
    setStatus("");
    setRows([]);
    setRawResult("");
    onTitleChange("New Connection");
  }

  async function runMysqlQuery() {
    if (!connectionId) return;
    setError("");
    try {
      const result = await invoke<Record<string, unknown>[]>("mysql_query", {
        id: connectionId,
        sql,
      });
      setRows(result);
      setRawResult("");
    } catch (e) {
      setError(String(e));
    }
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
      setRows([]);
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
      setRows([]);
    } catch (e) {
      setError(String(e));
    }
  }

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  const connectionForm = (
    <fieldset>
      <legend>Connection</legend>
      <div className="row">
        <label>
          Type{" "}
          <select value={kind} onChange={(e) => changeKind(e.target.value as DbKind)}>
            <option value="mysql">MySQL</option>
            <option value="mongo">MongoDB</option>
            <option value="redis">Redis</option>
          </select>
        </label>
        <label>
          Host <input value={host} onChange={(e) => setHost(e.target.value)} />
        </label>
        <label>
          Port{" "}
          <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
        </label>
      </div>
      <div className="row">
        <label>
          User <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password{" "}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          {kind === "redis" ? "DB index" : "Database"}{" "}
          <input value={database} onChange={(e) => setDatabase(e.target.value)} />
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

      <div className="row">
        <label>
          <input type="checkbox" checked={useSsh} onChange={(e) => setUseSsh(e.target.checked)} />{" "}
          Connect via SSH tunnel
        </label>
      </div>
      {useSsh && (
        <div className="row">
          <label>
            SSH host <input value={sshHost} onChange={(e) => setSshHost(e.target.value)} />
          </label>
          <label>
            SSH port{" "}
            <input
              type="number"
              value={sshPort}
              onChange={(e) => setSshPort(Number(e.target.value))}
            />
          </label>
          <label>
            SSH user <input value={sshUser} onChange={(e) => setSshUser(e.target.value)} />
          </label>
          <label>
            Auth{" "}
            <select
              value={sshAuthType}
              onChange={(e) => setSshAuthType(e.target.value as "password" | "privatekey")}
            >
              <option value="password">Password</option>
              <option value="privatekey">Private key</option>
            </select>
          </label>
        </div>
      )}
      {useSsh && sshAuthType === "password" && (
        <div className="row">
          <label>
            SSH password{" "}
            <input
              type="password"
              value={sshPassword}
              onChange={(e) => setSshPassword(e.target.value)}
            />
          </label>
        </div>
      )}
      {useSsh && sshAuthType === "privatekey" && (
        <div className="row">
          <label>
            Private key file{" "}
            <input
              value={sshKeyPath}
              onChange={(e) => setSshKeyPath(e.target.value)}
              placeholder="C:\Users\you\.ssh\id_rsa"
            />
          </label>
          <button type="button" onClick={browseForPrivateKey}>
            Browse...
          </button>
          <label>
            Key passphrase{" "}
            <input
              type="password"
              value={sshPassphrase}
              onChange={(e) => setSshPassphrase(e.target.value)}
              placeholder="(leave blank if none)"
            />
          </label>
        </div>
      )}
      {useSsh && (
        <div className="row">
          <button type="button" onClick={testTunnel}>
            Test tunnel
          </button>
          <span>{tunnelStatus}</span>
        </div>
      )}

      <div className="row">
        <button onClick={connect}>Connect</button>
        <span>{status}</span>
      </div>

      <div className="row">
        <label>
          Save as{" "}
          <input
            value={saveAsName}
            onChange={(e) => setSaveAsName(e.target.value)}
            placeholder="Connection name"
          />
        </label>
        <button type="button" onClick={saveCurrentConnection} disabled={!saveAsName.trim()}>
          Save connection
        </button>
      </div>
    </fieldset>
  );

  if (!connectionId) {
    return (
      <div className="login-view">
        <aside className="saved-list">
          <h3>Saved connections</h3>
          {savedConnections.length === 0 && <p className="muted">No saved connections yet.</p>}
          <ul>
            {savedConnections.map((c) => (
              <li key={c.id}>
                <button type="button" className="saved-item" onClick={() => applySavedConnection(c)}>
                  <strong>{c.name}</strong>
                  <small>{c.config.kind} · {c.config.host}</small>
                </button>
                <button
                  type="button"
                  className="saved-item-delete"
                  onClick={() => deleteSavedConnection(c.id)}
                  title="Delete"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="login-form">
          {connectionForm}
          {error && <p className="error">{error}</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="workspace">
      <div className="row">
        <button onClick={disconnect}>Disconnect</button>
        <span>{status}</span>
      </div>

      {error && <p className="error">{error}</p>}

      {kind === "mysql" && (
        <fieldset>
          <legend>Query</legend>
          <textarea rows={4} value={sql} onChange={(e) => setSql(e.target.value)} />
          <div className="row">
            <button onClick={runMysqlQuery}>Run</button>
          </div>
        </fieldset>
      )}

      {kind === "mongo" && (
        <fieldset>
          <legend>Find</legend>
          <div className="row">
            <label>
              Collection{" "}
              <input
                value={mongoCollection}
                onChange={(e) => setMongoCollection(e.target.value)}
              />
            </label>
          </div>
          <textarea
            rows={3}
            value={mongoFilter}
            onChange={(e) => setMongoFilter(e.target.value)}
            placeholder="{}"
          />
          <div className="row">
            <button onClick={runMongoFind}>Find</button>
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
          />
          <div className="row">
            <button onClick={runRedisCommand}>Execute</button>
          </div>
        </fieldset>
      )}

      {columns.length > 0 && (
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c}>{String(row[c] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rawResult && <pre className="result">{rawResult}</pre>}
    </div>
  );
}

export default ConnectionTab;
