import { useEffect, useSyncExternalStore } from "react";
import { addSavedHost, loadSavedHosts, removeSavedHost, updateSavedHost } from "./savedHosts";
import type { SavedHost } from "./types";

/**
 * Danh sách host đã lưu, dùng chung bởi mọi tab.
 *
 * Đọc một lần: mỗi tab tự đọc thì mỗi tab tốn một lượt đọc file cộng một lượt hỏi kho thông tin
 * đăng nhập cho mỗi host, và một host lưu ở tab này sẽ không thấy ở tab kia cho tới lần mở app
 * sau. Danh sách là một thứ trên đĩa, nên nó là một thứ trong bộ nhớ.
 *
 * Đây là bản sao khoảng 60 dòng của `savedConnectionsStore.ts` trong module db, chép có chủ đích:
 * ranh giới module cấm dùng chung, và đây mới là chỗ thứ hai. Chỗ thứ ba thì tách ra `core/`.
 */

/** Cái mọi người đăng ký đang thấy. Thay cả cụm, không sửa tại chỗ: `useSyncExternalStore` quyết
 *  định có render lại hay không bằng cách so tham chiếu này với tham chiếu lần trước. */
let snapshot: SavedHost[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(list: SavedHost[]) {
  snapshot = list;
  loaded = true;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SavedHost[] {
  return snapshot;
}

/** Đọc một lần. Tab nào hỏi trước thì bắt đầu, tab nào mount trong lúc đó thì đi cùng một promise
 *  chứ không mở lượt đọc thứ hai. Đọc hỏng thì `loaded` ở lại `false` — tab sau thử lại. */
function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!inFlight) {
    inFlight = loadSavedHosts()
      .then(publish)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Danh sách dùng chung, giữ đồng bộ giữa mọi tab gọi nó. */
export function useSavedHosts(): SavedHost[] {
  useEffect(() => {
    // Không có chỗ nào ở đây báo được lỗi đọc — cột host chỉ đơn giản là trống, và tab sau thử
    // lại. Nuốt chứ không để reject, để nó không nổi lên thành unhandled promise.
    ensureLoaded().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/* Ghi thì đi qua module vẫn ghi từ trước — nó là chỗ giữ ranh giới giữa `terminal-hosts.json` và
   kho thông tin đăng nhập — và danh sách nó trả về thành ảnh chụp mới. */

export async function addHost(host: SavedHost): Promise<void> {
  publish(await addSavedHost(host));
}

export async function updateHost(host: SavedHost): Promise<void> {
  publish(await updateSavedHost(host));
}

export async function removeHost(id: string): Promise<void> {
  publish(await removeSavedHost(id));
}
