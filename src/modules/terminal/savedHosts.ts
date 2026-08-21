import { Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import type { SavedHost, SshConfig } from "./types";

/**
 * Danh sách host đã lưu, chia làm hai chỗ.
 *
 * `terminal-hosts.json` giữ cái một host *là* — tên, địa chỉ, cổng, người dùng, đường dẫn khoá —
 * và nó là văn bản thường có chủ đích: đó là danh sách những máy mình hay vào, đọc và chép được
 * thì tiện. Cái mở được cửa thì đi vào kho thông tin đăng nhập của hệ điều hành, qua ba lệnh
 * `secrets_*` mà module db cũng dùng.
 *
 * Id là uuid do module này sinh, nên nó không bao giờ đụng id của một kết nối database — hai bên
 * chia nhau một kho nhưng không chia nhau khoá nào.
 *
 * Chỗ chia là chuyện riêng của file này: cái đi vào và đi ra là một `SavedHost` đầy đủ.
 */

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load("terminal-hosts.json");
  }
  return storePromise;
}

/** Những gì không được nằm trong `terminal-hosts.json`. Tên khoá đi vào keyring cùng id của host. */
export interface HostSecrets {
  sshPassword?: string;
  sshPassphrase?: string;
}

/** Cấu hình chẻ làm đôi: phần ghi được xuống file, và phần đi vào kho thông tin đăng nhập. */
export function splitSecrets(config: SshConfig): { config: SshConfig; secrets: HostSecrets } {
  if (config.auth.type === "password") {
    const password = config.auth.password;
    return {
      config: { ...config, auth: { type: "password", password: "" } },
      // Một tập rỗng làm `secrets_save` xoá hẳn entry, nên một host không có gì để giấu cũng
      // không để lại gì.
      secrets: password ? { sshPassword: password } : {},
    };
  }
  const { key_path, passphrase } = config.auth;
  return {
    // Đường dẫn khoá ở lại trong file: nó là chỗ để tìm khoá, không phải chính khoá.
    config: { ...config, auth: { type: "privatekey", key_path, passphrase: undefined } },
    secrets: passphrase ? { sshPassphrase: passphrase } : {},
  };
}

/** Cấu hình như form cần: cái đã ở trên đĩa, với phần bí mật đặt lại vào. */
export function mergeSecrets(config: SshConfig, secrets: HostSecrets): SshConfig {
  if (config.auth.type === "password") {
    return {
      ...config,
      auth: { type: "password", password: secrets.sshPassword ?? config.auth.password },
    };
  }
  return {
    ...config,
    auth: {
      type: "privatekey",
      key_path: config.auth.key_path,
      passphrase: secrets.sshPassphrase ?? config.auth.passphrase,
    },
  };
}

function saveSecrets(id: string, secrets: HostSecrets): Promise<void> {
  return invoke<void>("secrets_save", { id, secrets });
}

function loadSecrets(id: string): Promise<HostSecrets> {
  return invoke<HostSecrets>("secrets_load", { id });
}

/** Cái thật sự nằm trên đĩa, phần bí mật đã bị lấy ra từ trước. */
async function loadStored(): Promise<SavedHost[]> {
  const store = await getStore();
  return (await store.get<SavedHost[]>("hosts")) ?? [];
}

async function persist(list: SavedHost[]): Promise<void> {
  const store = await getStore();
  await store.set(
    "hosts",
    list.map((host) => ({ ...host, config: splitSecrets(host.config).config })),
  );
  await store.save();
}

/** Mọi host đã lưu, phần bí mật đã ghép lại. Một host mà kho không còn gì cho nó vẫn về đây — chỉ
 *  là ô mật khẩu trống, và đó là điều đúng để hiện. */
export async function loadSavedHosts(): Promise<SavedHost[]> {
  const stored = await loadStored();
  return Promise.all(
    stored.map(async (host) => ({
      ...host,
      config: mergeSecrets(host.config, await loadSecrets(host.id)),
    })),
  );
}

/** Ghi bí mật của `host` vào kho của hệ điều hành, rồi cả danh sách — không bí mật nào — xuống
 *  file. Những host khác cũng bị lược: chúng vừa được trao đi với phần bí mật đã ghép vào. */
async function persistHost(list: SavedHost[], host: SavedHost): Promise<void> {
  await saveSecrets(host.id, splitSecrets(host.config).secrets);
  await persist(list);
}

export async function addSavedHost(host: SavedHost): Promise<SavedHost[]> {
  const list = await loadSavedHosts();
  const next = [...list, host];
  await persistHost(next, host);
  return next;
}

export async function updateSavedHost(host: SavedHost): Promise<SavedHost[]> {
  const list = await loadSavedHosts();
  const next = list.map((h) => (h.id === host.id ? host : h));
  await persistHost(next, host);
  return next;
}

export async function removeSavedHost(id: string): Promise<SavedHost[]> {
  const list = await loadSavedHosts();
  const next = list.filter((h) => h.id !== id);
  // Bí mật đi theo host nó thuộc về; để lại là để một entry trong kho của hệ điều hành mà không
  // còn gì gọi tên nó nữa.
  await invoke<void>("secrets_delete", { id });
  await persist(next);
  return next;
}
