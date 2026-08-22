import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { localShells } from "../../api";
import { ShellIcon } from "../../icons";
import { addHost, removeHost, updateHost, useSavedHosts } from "../../savedHostsStore";
import { loadTerminalSettings } from "../../settingsStore";
import { shellLabel } from "../../shells";
import type { LocalShell, SavedHost, SshAuth, SshConfig, TerminalChoice } from "../../types";
import SavedHostList from "./SavedHostList";
import styles from "./TargetForm.module.css";

/** Đường dẫn khoá riêng trông như thế nào trên máy đang chạy — một gợi ý, không phải một chuỗi
 *  dịch được: một đường dẫn không có bản tiếng Việt. */
const PRIVATE_KEY_PLACEHOLDER = navigator.userAgent.includes("Windows")
  ? "C:\\Users\\you\\.ssh\\id_ed25519"
  : navigator.userAgent.includes("Mac")
    ? "/Users/you/.ssh/id_ed25519"
    : "/home/you/.ssh/id_ed25519";

const DEFAULT_SSH_PORT = 22;

interface Props {
  onOpen: (choice: TerminalChoice) => void;
  onError: (message: string) => void;
  /** Cái tab vừa thử mở và hỏng. Form dựng lại đúng những gì người dùng đã gõ — một form bị xoá
   *  trắng sau mỗi lần sai mật khẩu là một form không ai dùng nổi. */
  initial: TerminalChoice | null;
}

/** Màn hình một tab terminal hiện trước khi có phiên: chọn máy này hay một máy chủ. */
function TargetForm({ onOpen, onError, initial }: Props) {
  const { t } = useTranslation();
  const hosts = useSavedHosts();

  const [kind, setKind] = useState<"local" | "ssh">(initial?.kind ?? "local");

  // Máy này
  const [shells, setShells] = useState<LocalShell[]>([]);
  const [path, setPath] = useState(initial?.kind === "local" ? initial.shell.path : "");
  const [cwd, setCwd] = useState(initial?.kind === "local" ? (initial.cwd ?? "") : "");

  // SSH
  const [hostId, setHostId] = useState<string | null>(
    initial?.kind === "ssh" ? initial.hostId : null,
  );
  const [name, setName] = useState("");
  const [host, setHost] = useState(initial?.kind === "ssh" ? initial.config.host : "");
  const [port, setPort] = useState(initial?.kind === "ssh" ? initial.config.port : DEFAULT_SSH_PORT);
  const [username, setUsername] = useState(initial?.kind === "ssh" ? initial.config.username : "");
  const [authType, setAuthType] = useState<"password" | "privatekey">(
    initial?.kind === "ssh" ? initial.config.auth.type : "password",
  );
  const [password, setPassword] = useState(
    initial?.kind === "ssh" && initial.config.auth.type === "password"
      ? initial.config.auth.password
      : "",
  );
  const [keyPath, setKeyPath] = useState(
    initial?.kind === "ssh" && initial.config.auth.type === "privatekey"
      ? initial.config.auth.key_path
      : "",
  );
  const [passphrase, setPassphrase] = useState(
    initial?.kind === "ssh" && initial.config.auth.type === "privatekey"
      ? (initial.config.auth.passphrase ?? "")
      : "",
  );

  useEffect(() => {
    /* Hai lượt đọc song song chứ không nối tiếp, và `loadTerminalSettings` chứ không
       `currentTerminalSettings`: store nạp file bất đồng bộ, nên hỏi nó ngay lúc này thường nhận
       về giá trị mặc định chứ không phải shell người dùng đã chọn. */
    Promise.all([localShells(), loadTerminalSettings()])
      .then(([found, settings]) => {
        setShells(found);
        const preferred = settings.defaultShell
          ? found.find((shell) => shell.name === settings.defaultShell)
          : undefined;
        /* `current ||` giữ nguyên cái `initial` đã đặt: một lần mở hỏng rồi thử lại phải quay về
           đúng shell vừa thử, không phải về shell mặc định. Shell mặc định đã gỡ khỏi máy thì
           `preferred` là `undefined` và cái Rust gợi ý đầu danh sách nhận chỗ. */
        setPath((current) => current || preferred?.path || (found[0]?.path ?? ""));
        const dir = settings.defaultCwd;
        if (dir) setCwd((current) => current || dir);
      })
      .catch((e) => onError(errorMessage(t, e)));
    // Chỉ chạy một lần: danh sách shell của một máy không đổi giữa chừng.
  }, []);

  const chosenShell = shells.find((shell) => shell.path === path);

  async function browseDirectory() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") setCwd(picked);
  }

  async function browseKeyFile() {
    const picked = await openDialog({ directory: false, multiple: false });
    if (typeof picked === "string") setKeyPath(picked);
  }

  function buildAuth(): SshAuth {
    return authType === "password"
      ? { type: "password", password }
      : { type: "privatekey", key_path: keyPath, passphrase: passphrase || undefined };
  }

  function buildConfig(): SshConfig {
    return { host: host.trim(), port, username: username.trim(), auth: buildAuth() };
  }

  /** Đủ để một lần thử có nghĩa: địa chỉ, người dùng, và cái mà cách xác thực đang chọn cần. */
  const sshReady =
    host.trim() !== "" &&
    username.trim() !== "" &&
    (authType === "password" ? password !== "" : keyPath.trim() !== "");

  function applyHost(entry: SavedHost) {
    // Cột host luôn ở đó, kể cả khi form đang ở "Máy này" — bấm một host mà form không đổi sang
    // SSH thì cú bấm ấy trông như không có tác dụng gì.
    setKind("ssh");
    setHostId(entry.id);
    setName(entry.name);
    setHost(entry.config.host);
    setPort(entry.config.port);
    setUsername(entry.config.username);
    setAuthType(entry.config.auth.type);
    setPassword(entry.config.auth.type === "password" ? entry.config.auth.password : "");
    setKeyPath(entry.config.auth.type === "privatekey" ? entry.config.auth.key_path : "");
    setPassphrase(
      entry.config.auth.type === "privatekey" ? (entry.config.auth.passphrase ?? "") : "",
    );
  }

  /** Nháy đúp một host: nạp nó vào form rồi mở luôn. Cấu hình lấy thẳng từ mục được bấm chứ không
   *  từ state — `applyHost` vừa gọi `setState`, mà state thì phải sang lần render sau mới đổi. */
  function openHost(entry: SavedHost) {
    applyHost(entry);
    onOpen({ kind: "ssh", config: entry.config, hostId: entry.id });
  }

  function clearHostForm() {
    setHostId(null);
    setName("");
    setHost("");
    setPort(DEFAULT_SSH_PORT);
    setUsername("");
    setAuthType("password");
    setPassword("");
    setKeyPath("");
    setPassphrase("");
  }

  async function saveHost() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      if (hostId) {
        await updateHost({ id: hostId, name: trimmed, config: buildConfig() });
      } else {
        const entry: SavedHost = { id: crypto.randomUUID(), name: trimmed, config: buildConfig() };
        await addHost(entry);
        setHostId(entry.id);
      }
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }

  async function deleteHost(id: string) {
    try {
      await removeHost(id);
      if (hostId === id) clearHostForm();
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }

  return (
    <div className={styles.layout}>
      {/* Luôn hiện, không chỉ ở tab SSH: đây là danh sách những chỗ người dùng hay tới, và một danh
          sách chỉ hiện ra sau khi đã bấm đúng tab thì không đỡ được ai lần bấm nào. */}
      <SavedHostList
        hosts={hosts}
        selectedId={kind === "ssh" ? hostId : null}
        onSelect={applyHost}
        onOpen={openHost}
        onDelete={(id) => void deleteHost(id)}
        onNew={() => {
          // "+" là "một máy chủ mới", nên nó cũng mang form sang bên SSH; `clearHostForm` một mình
          // thì không, vì nó còn được gọi khi host đang chọn bị xoá.
          setKind("ssh");
          clearHostForm();
        }}
      />

      <div className={styles.form}>
        {/* Hai kiểu đích. Nút chứ không phải `Select`: chỉ có hai, và cái đang chọn quyết định cả
            phần còn lại của form — đáng để thấy được cả hai cùng lúc. */}
        <div className={styles.kinds} role="tablist" aria-label={t("terminal.newTabTitle")}>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "local"}
            className={`${styles.kind}${kind === "local" ? ` ${styles.kindActive}` : ""}`}
            onClick={() => setKind("local")}
          >
            {t("terminal.targetLocal")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "ssh"}
            className={`${styles.kind}${kind === "ssh" ? ` ${styles.kindActive}` : ""}`}
            onClick={() => setKind("ssh")}
          >
            {t("terminal.targetSsh")}
          </button>
        </div>

        {kind === "local" ? (
          <>
            <div className={styles.row}>
              {/* `Select` không nhận `id`, nên nhãn của nó là `ariaLabel` chứ không phải `htmlFor` */}
              <span>{t("terminal.shell")}</span>
              <Select
                value={path}
                options={shells.map((shell) => ({
                  value: shell.path,
                  label: (
                    <span className={styles.shellOption}>
                      <ShellIcon name={shell.name} />
                      {shellLabel(shell.name)}
                    </span>
                  ),
                  // Nhãn là node nên ô tìm kiếm không đọc được nó; đây là chữ nó đọc.
                  searchText: shellLabel(shell.name),
                }))}
                onChange={setPath}
                ariaLabel={t("terminal.shell")}
                placeholder={t("terminal.noShells")}
              />
            </div>

            <div className={styles.row}>
              <label htmlFor="terminal-cwd">{t("terminal.startIn")}</label>
              <div className={styles.withButton}>
                <Input
                  id="terminal-cwd"
                  value={cwd}
                  placeholder={t("terminal.startInPlaceholder")}
                  onChange={(e) => setCwd(e.target.value)}
                />
                <Button onClick={() => void browseDirectory()}>{t("terminal.browse")}</Button>
              </div>
            </div>

            <Button
              variant="primary"
              disabled={!chosenShell}
              onClick={() =>
                chosenShell && onOpen({ kind: "local", shell: chosenShell, cwd: cwd.trim() || null })
              }
            >
              {t("terminal.open")}
            </Button>
          </>
        ) : (
          <>
            <div className={styles.row}>
              <label htmlFor="terminal-host-name">{t("terminal.hostName")}</label>
              <Input
                id="terminal-host-name"
                value={name}
                placeholder={t("terminal.hostNamePlaceholder")}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className={styles.columns}>
              <div className={styles.row}>
                <label htmlFor="terminal-host">{t("terminal.host")}</label>
                <Input id="terminal-host" value={host} onChange={(e) => setHost(e.target.value)} />
              </div>
              <div className={`${styles.row} ${styles.narrow}`}>
                <label htmlFor="terminal-port">{t("terminal.port")}</label>
                <Input
                  id="terminal-port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </div>
            </div>

            <div className={styles.row}>
              <label htmlFor="terminal-user">{t("terminal.username")}</label>
              <Input
                id="terminal-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className={styles.row}>
              <span>{t("terminal.authMethod")}</span>
              <Select
                value={authType}
                options={[
                  { value: "password", label: t("terminal.authPassword") },
                  { value: "privatekey", label: t("terminal.authPrivateKey") },
                ]}
                onChange={(value) => setAuthType(value)}
                ariaLabel={t("terminal.authMethod")}
              />
            </div>

            {authType === "password" ? (
              <div className={styles.row}>
                <label htmlFor="terminal-password">{t("terminal.password")}</label>
                <Input
                  id="terminal-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div className={styles.row}>
                  <label htmlFor="terminal-key">{t("terminal.privateKeyFile")}</label>
                  <div className={styles.withButton}>
                    <Input
                      id="terminal-key"
                      value={keyPath}
                      placeholder={PRIVATE_KEY_PLACEHOLDER}
                      onChange={(e) => setKeyPath(e.target.value)}
                    />
                    <Button onClick={() => void browseKeyFile()}>{t("terminal.browse")}</Button>
                  </div>
                </div>
                <div className={styles.row}>
                  <label htmlFor="terminal-passphrase">{t("terminal.keyPassphrase")}</label>
                  <Input
                    id="terminal-passphrase"
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className={styles.actions}>
              <Button disabled={!name.trim()} onClick={() => void saveHost()}>
                {hostId ? t("terminal.updateHost") : t("terminal.saveHost")}
              </Button>
              <Button
                variant="primary"
                disabled={!sshReady}
                onClick={() => onOpen({ kind: "ssh", config: buildConfig(), hostId })}
              >
                {t("terminal.connect")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default TargetForm;
