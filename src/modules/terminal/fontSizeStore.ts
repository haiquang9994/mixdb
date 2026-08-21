import { useSyncExternalStore } from "react";
import { DEFAULT_FONT_SIZE, stepFontSize } from "./fontSize";

/**
 * Cỡ chữ terminal đang dùng, chung cho cả app và nhớ lại giữa các lần mở.
 *
 * Một giá trị chứ không phải một giá trị mỗi tab: phóng to là vì mắt người dùng, và mắt thì không
 * đổi khi họ chuyển tab. Nhớ trong `localStorage` như theme và accent — cùng loại thứ, cùng chỗ.
 */
const STORAGE_KEY = "mixdb-terminal-font-size";

/* Đọc lười chứ không đọc lúc import: file test chạy trong môi trường `node`, ở đó không có
   `localStorage`, và một lần đọc ở tầng module sẽ nổ ngay khi có ai import file này. */
let size: number | null = null;
const listeners = new Set<() => void>();

function read(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return DEFAULT_FONT_SIZE;
    return stepFontSize(Number(stored), 0);
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number {
  if (size === null) size = read();
  return size;
}

/** To lên (`delta` dương) hay nhỏ đi (`delta` âm) một nấc. Chạm đầu khoảng thì không ai được báo —
 *  không có gì đổi thì không có gì để vẽ lại. */
export function zoomTerminal(delta: number): void {
  const next = stepFontSize(getSnapshot(), delta);
  if (next === size) return;
  size = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // Không ghi được thì phiên này vẫn phóng to; chỉ là lần mở sau không nhớ.
  }
  for (const listener of listeners) listener();
}

export function useTerminalFontSize(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
