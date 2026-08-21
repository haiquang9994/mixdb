/** Một shell dò được trên máy này. `name` là định danh bền — `shells.ts` biến nó thành nhãn. */
export interface LocalShell {
  /** `powershell`, `pwsh`, `cmd`, `git-bash`, `wsl:<distro>`, `zsh`, `bash`, `sh`. */
  name: string;
  path: string;
  /** Tham số cố định của shell đó; rỗng với hầu hết, `["-d", "<distro>"]` với WSL. */
  args: string[];
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** Đích của một phiên, đúng hình dạng `TerminalTarget` bên Rust. Đợt 2 thêm nhánh `ssh`. */
export type TerminalTarget = {
  type: "local";
  shell: string;
  args: string[];
  cwd: string | null;
};

/** Cái người dùng chọn trong form. Rộng hơn `TerminalTarget` một chút: giữ cả `LocalShell` để
 *  đặt tên tab, thứ Rust không cần biết. */
export interface LocalChoice {
  shell: LocalShell;
  cwd: string | null;
}
