import { useEffect, useSyncExternalStore } from "react";
import {
  addSavedTarget,
  loadSavedTargets,
  removeSavedTarget,
  updateSavedTarget,
} from "./savedTargets";
import type { SavedTarget } from "./types";

/**
 * Danh sách đích đã lưu, dùng chung bởi mọi tab.
 *
 * Đọc một lần: mỗi tab tự đọc thì mỗi tab tốn một lượt đọc file cộng một lượt hỏi kho thông tin
 * đăng nhập cho mỗi máy chủ, và một đích lưu ở tab này sẽ không thấy ở tab kia cho tới lần mở app
 * sau. Danh sách là một thứ trên đĩa, nên nó là một thứ trong bộ nhớ.
 *
 * Đây là bản sao khoảng 60 dòng của `savedConnectionsStore.ts` trong module db, chép có chủ đích:
 * ranh giới module cấm dùng chung, và đây mới là chỗ thứ hai. Chỗ thứ ba thì tách ra `core/`.
 */

/** Cái mọi người đăng ký đang thấy. Thay cả cụm, không sửa tại chỗ: `useSyncExternalStore` quyết
 *  định có render lại hay không bằng cách so tham chiếu này với tham chiếu lần trước. */
let snapshot: SavedTarget[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(list: SavedTarget[]) {
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

function getSnapshot(): SavedTarget[] {
  return snapshot;
}

function getLoaded(): boolean {
  return loaded;
}

/** Đọc một lần. Tab nào hỏi trước thì bắt đầu, tab nào mount trong lúc đó thì đi cùng một promise
 *  chứ không mở lượt đọc thứ hai. Đọc hỏng thì `loaded` ở lại `false` — tab sau thử lại. */
function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!inFlight) {
    inFlight = loadSavedTargets()
      .then(publish)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Danh sách dùng chung, giữ đồng bộ giữa mọi tab gọi nó. */
export function useSavedTargets(): SavedTarget[] {
  useEffect(() => {
    // Không có chỗ nào ở đây báo được lỗi đọc — cột bên trái chỉ đơn giản là trống, và tab sau thử
    // lại. Nuốt chứ không để reject, để nó không nổi lên thành unhandled promise.
    ensureLoaded().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Đã đọc xong file chưa. Danh sách rỗng lúc chưa đọc và danh sách rỗng khi không có đích nào là
 *  hai thứ khác nhau, mà nhìn vào danh sách thì không phân biệt được. Ai coi "không có trong danh
 *  sách" là "đã bị xoá" — một tab đang khôi phục đích nó mở dở — phải hỏi cái này trước. */
export function useSavedTargetsLoaded(): boolean {
  return useSyncExternalStore(subscribe, getLoaded);
}

/* Ghi thì đi qua module vẫn ghi từ trước — nó là chỗ giữ ranh giới giữa `terminal-hosts.json` và
   kho thông tin đăng nhập — và danh sách nó trả về thành ảnh chụp mới. */

export async function addTarget(target: SavedTarget): Promise<void> {
  publish(await addSavedTarget(target));
}

export async function updateTarget(target: SavedTarget): Promise<void> {
  publish(await updateSavedTarget(target));
}

export async function removeTarget(id: string): Promise<void> {
  publish(await removeSavedTarget(id));
}
