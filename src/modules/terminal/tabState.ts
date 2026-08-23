import type { TerminalChoice } from "./types";

/**
 * Cái một tab terminal nhớ giữa hai lần mở app: nó đang ở host đã lưu nào, hoặc shell cục bộ nào.
 *
 * Nhánh `ssh` chỉ có một uuid — host, cổng, tên đăng nhập và bí mật nằm trong
 * `terminal-hosts.json` cộng kho thông tin đăng nhập của OS, và không cái nào được chép ra đây.
 * Nhánh `local` giữ `name` của shell (`powershell`, `wsl:Ubuntu`) chứ không giữ đường dẫn, vì
 * `name` là định danh bền còn đường dẫn thì đổi theo máy. `cwd` là thứ duy nhất trong file này
 * không phải id: nó là một đường dẫn trên máy người dùng, không phải bí mật. Vạch nằm ở đó — §4
 * của `docs/superpowers/specs/2026-08-23-tab-session-context-design.md`.
 */
export type TerminalTabState =
  | { kind: "ssh"; hostId: string }
  | { kind: "local"; shellName: string; cwd: string | null };

/**
 * Giá trị đã lưu, nếu nó là một, không thì `null`.
 *
 * Validation sống ở đây — shell cố ý đưa khe state qua mà không nhìn, vì chỉ module này biết hình
 * dạng của nó. Mọi thứ tới đây là chuỗi một phiên bản cũ nào đó của app đã ghi, nên không tin gì.
 */
export function parseTerminalTabState(value: unknown): TerminalTabState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;

  if (state.kind === "ssh") {
    if (typeof state.hostId !== "string" || state.hostId === "") return null;
    return { kind: "ssh", hostId: state.hostId };
  }

  if (state.kind === "local") {
    if (typeof state.shellName !== "string" || state.shellName === "") return null;
    // `cwd` vắng mặt và `cwd` là null là một thứ: mở shell ở thư mục mặc định của nó.
    if (state.cwd === undefined || state.cwd === null) {
      return { kind: "local", shellName: state.shellName, cwd: null };
    }
    if (typeof state.cwd !== "string") return null;
    return { kind: "local", shellName: state.shellName, cwd: state.cwd };
  }

  return null;
}

/**
 * Phần đáng nhớ của một lựa chọn, hoặc `undefined` khi không có gì trỏ tới được.
 *
 * SSH gõ tay không có `hostId`, và cái duy nhất mở lại được nó là mật khẩu — thứ không bao giờ đi
 * vào `localStorage`. Nên nó không nhớ gì, và lần sau tab ấy mở ra là form. Đó là vạch giữ đúng,
 * không phải chỗ còn thiếu.
 */
export function tabStateFor(choice: TerminalChoice): TerminalTabState | undefined {
  if (choice.kind === "local") {
    return { kind: "local", shellName: choice.shell.name, cwd: choice.cwd };
  }
  return choice.hostId === null ? undefined : { kind: "ssh", hostId: choice.hostId };
}
