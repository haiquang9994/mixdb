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

/** Cách chứng minh mình là ai với máy chủ SSH. Gương của `SshAuth` bên Rust. */
export type SshAuth =
  | { type: "password"; password: string }
  | { type: "privatekey"; key_path: string; passphrase?: string };

/** Máy chủ SSH mở phiên. Cùng bốn trường mà module db dùng cho tunnel của nó, và cố ý là một kiểu
 *  khác: hai module không dùng chung host, nên chúng không dùng chung kiểu. */
export interface SshConfig {
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
}

/** Một máy chủ người dùng đã lưu lại. `config` ở đây luôn đầy đủ — `savedHosts.ts` ghép phần bí
 *  mật từ kho thông tin đăng nhập vào trước khi trao nó cho ai. */
export interface SavedHost {
  id: string;
  name: string;
  config: SshConfig;
  /**
   * Lệnh gõ hộ ngay khi shell bên kia sẵn sàng — `cd ~/project-a/frontend`, `nvm use`, mấy dòng
   * đầu tiên vẫn phải gõ lại mỗi lần vào máy ấy. Mỗi dòng là một lệnh.
   *
   * Ngoài `config` chứ không nằm trong: `SshConfig` là gương của kiểu bên Rust, còn cái này Rust
   * không bao giờ thấy — nó đi xuống pty như phím người dùng bấm. Và nó nằm nguyên văn trong
   * `terminal-hosts.json`, nên nó không phải chỗ để mật khẩu; xem đầu `savedHosts.ts`.
   */
  runOnConnect?: string;
}

/** Đích của một phiên, đúng hình dạng `TerminalTarget` bên Rust. Nhánh `ssh` trải phẳng bốn trường
 *  của `SshConfig` vì bên Rust nó là một nhánh newtype trong enum có `tag`. */
export type TerminalTarget =
  | { type: "local"; shell: string; args: string[]; cwd: string | null }
  | ({ type: "ssh" } & SshConfig);

/**
 * Cái người dùng chọn trong form. Rộng hơn `TerminalTarget`: giữ cả `LocalShell` để đặt tên tab và
 * `hostId` để biết phiên này đến từ host đã lưu nào — hai thứ Rust không cần biết.
 */
export type TerminalChoice =
  | { kind: "local"; shell: LocalShell; cwd: string | null }
  | { kind: "ssh"; config: SshConfig; hostId: string | null; runOnConnect: string | null };
