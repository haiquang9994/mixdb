import { shellLabel } from "./shells";
import type { TerminalChoice, TerminalTarget } from "./types";

/** Một dấu tab này nên mang. `TerminalTab` biến nó thành `TabBadge` vì nó là chỗ có `t`. */
export type TerminalBadgeMark = { type: "local" } | { type: "ssh" } | { type: "ended" };

/** Cái người dùng chọn, rút gọn thành cái Rust cần. Nhãn hiển thị ở lại đây. */
export function terminalTarget(choice: TerminalChoice): TerminalTarget {
  if (choice.kind === "local") {
    return { type: "local", shell: choice.shell.path, args: choice.shell.args, cwd: choice.cwd };
  }
  return { type: "ssh", ...choice.config };
}

/** Tên tab: tên shell, hoặc `user@host` — không phải đường dẫn và không phải tên host đã lưu, vì
 *  tab bar chỉ rộng vài chữ. */
export function terminalTitle(choice: TerminalChoice): string {
  return choice.kind === "local"
    ? shellLabel(choice.shell.name)
    : `${choice.config.username}@${choice.config.host}`;
}

/**
 * Tab bar nên hiện dấu gì.
 *
 * Chưa mở phiên thì không dấu nào: form trên màn hình có thể đang chọn một đích khác hẳn cái tab
 * sẽ chạy, đúng như `dbBadgeMarks` không đánh dấu một tab còn đang ở form kết nối.
 */
export function terminalBadgeMarks(
  choice: TerminalChoice | null,
  ended: boolean,
): TerminalBadgeMark[] {
  if (!choice) return [];
  const marks: TerminalBadgeMark[] = [{ type: choice.kind === "local" ? "local" : "ssh" }];
  if (ended) marks.push({ type: "ended" });
  return marks;
}
