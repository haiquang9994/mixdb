import { shellLabel } from "./shells";
import type { LocalChoice, TerminalTarget } from "./types";

/** Một dấu tab này nên mang. `TerminalTab` biến nó thành `TabBadge` vì nó là chỗ có `t`. */
export type TerminalBadgeMark = { type: "local" } | { type: "ended" };

/** Cái người dùng chọn, rút gọn thành cái Rust cần. Nhãn hiển thị ở lại đây. */
export function localTarget(choice: LocalChoice): TerminalTarget {
  return { type: "local", shell: choice.shell.path, args: choice.shell.args, cwd: choice.cwd };
}

/** Tên tab: tên shell, không phải đường dẫn — tab bar chỉ rộng vài chữ. */
export function terminalTitle(choice: LocalChoice): string {
  return shellLabel(choice.shell.name);
}

/**
 * Tab bar nên hiện dấu gì.
 *
 * Chưa mở phiên thì không dấu nào: form trên màn hình có thể đang chọn một shell khác hẳn cái tab
 * sẽ chạy, đúng như `dbBadgeMarks` không đánh dấu một tab còn đang ở form kết nối.
 */
export function terminalBadgeMarks(started: boolean, ended: boolean): TerminalBadgeMark[] {
  if (!started) return [];
  const marks: TerminalBadgeMark[] = [{ type: "local" }];
  if (ended) marks.push({ type: "ended" });
  return marks;
}
