import { useEffect, useSyncExternalStore } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { stepFontSize } from "./fontSize";
import {
  DEFAULT_SETTINGS,
  LEGACY_FONT_SIZE_KEY,
  sanitizeSettings,
  withLegacyFontSize,
  type TerminalSettings,
} from "./settings";

/**
 * Cài đặt hiển thị đang dùng, chung cho mọi tab terminal và nhớ lại giữa các lần mở.
 *
 * Bản sao khuôn của `rest/workspace.ts`, chép có chủ đích: ranh giới module cấm hai module dùng
 * chung một store, và cái đáng tách ra `core/` là *cơ chế* `useSyncExternalStore` chứ không phải
 * ba chục dòng nối nó với một file JSON. Chỗ thứ ba xuất hiện thì tách.
 */

const FILE = "terminal-settings.json";
const KEY = "settings";

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(FILE);
  return storePromise;
}

let snapshot: TerminalSettings = DEFAULT_SETTINGS;
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: TerminalSettings) {
  snapshot = next;
  loaded = true;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Cỡ chữ mà đợt trước để lại, và cùng lúc dọn nó đi. Đọc trong `try` vì `localStorage` ném ở
 *  những webview cấm lưu trữ theo site — và một cỡ chữ không đọc được thì mặc định là câu trả lời
 *  đúng, không phải một lỗi để báo. */
function takeLegacyFontSize(): string | null {
  try {
    const value = localStorage.getItem(LEGACY_FONT_SIZE_KEY);
    localStorage.removeItem(LEGACY_FONT_SIZE_KEY);
    return value;
  } catch {
    return null;
  }
}

function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!inFlight) {
    inFlight = getStore()
      .then(async (store) => {
        const raw = await store.get(KEY);
        const settings = withLegacyFontSize(raw, takeLegacyFontSize());
        publish(settings);
        /* Ghi lại ngay sau khi nạp, chứ không đợi lần sửa đầu tiên: khoá `localStorage` vừa bị
           xoá, nên cỡ chữ cũ giờ chỉ còn tồn tại trong `snapshot`. Không ghi thì một lần thoát
           app là nó mất. */
        await store.set(KEY, settings);
        await store.save();
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

function write(next: TerminalSettings): void {
  publish(next);
  void getStore()
    .then(async (store) => {
      await store.set(KEY, next);
      await store.save();
    })
    .catch(() => {});
}

/** Cài đặt dùng chung, giữ đồng bộ giữa mọi nơi gọi nó. */
export function useTerminalSettings(): TerminalSettings {
  useEffect(() => {
    // Đọc hỏng thì `loaded` ở lại `false` và màn hình chạy bằng mặc định; không có chỗ nào ở đây
    // báo được lỗi, và một terminal vẽ bằng cỡ chữ mặc định vẫn là một terminal dùng được.
    ensureLoaded().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Cái store đang giữ ngay lúc này, cho chỗ gọi không phải component — một handler chuột phải đọc
 *  công tắc của nó ở thời điểm bấm, chứ không ở thời điểm handler được dựng. */
export function currentTerminalSettings(): TerminalSettings {
  return snapshot;
}

/**
 * Cài đặt, đợi file nạp xong.
 *
 * Khác {@link currentTerminalSettings} ở đúng chỗ đáng khác: một màn hình mở ra ngay lúc app khởi
 * động mà hỏi thẳng `snapshot` thì nhận về mặc định, vì lượt đọc file chưa xong. `TargetForm` cần
 * shell mặc định *đúng* chứ không cần nó *ngay*, nên nó đợi.
 *
 * Đọc hỏng vẫn trả về một bộ cài đặt — bộ mặc định — chứ không ném: form vẫn phải mở ra được.
 */
export function loadTerminalSettings(): Promise<TerminalSettings> {
  return ensureLoaded().then(
    () => snapshot,
    () => snapshot,
  );
}

/** Một lần sửa cài đặt. Một cửa chứ không phải một setter mỗi trường: pane Cài đặt sửa mỗi lần
 *  một trường và không trường nào cần thứ trường khác không cần. */
export function updateTerminalSettings(patch: Partial<TerminalSettings>): void {
  /* Lọc cả lúc ghi chứ không chỉ lúc đọc file. Một trường hỏng ở đây không dừng lại ở chỗ nó bị
     ghi sai: `fontFamily` rỗng đi thẳng vào `term.options.fontFamily`, xterm dựng `ctx.font` từ nó,
     chuỗi ấy không phân tích được, canvas bỏ qua phép gán và giữ số đo ô chữ cũ — chữ to lên mà
     dòng đứng nguyên. Đúng một dòng ở đây là mọi cửa ghi đều không mở được lối ấy nữa. */
  write(sanitizeSettings({ ...snapshot, ...patch }));
}

/** To lên (`delta` dương) hay nhỏ đi (`delta` âm) một nấc. Chạm đầu khoảng thì không ghi và không
 *  ai được báo — không có gì đổi thì không có gì để vẽ lại. */
export function zoomTerminal(delta: number): void {
  const fontSize = stepFontSize(snapshot.fontSize, delta);
  if (fontSize === snapshot.fontSize) return;
  write({ ...snapshot, fontSize });
}
