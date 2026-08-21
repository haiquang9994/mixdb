/** Tiền tố Rust dùng cho một bản phân phối WSL: `wsl:Ubuntu`. */
const WSL_PREFIX = "wsl:";

/** Tên riêng, nên không dịch — cái được dịch là nhãn của ô chọn, không phải nội dung của nó. */
const LABELS: Record<string, string> = {
  powershell: "Windows PowerShell",
  pwsh: "PowerShell 7",
  cmd: "Command Prompt",
  "git-bash": "Git Bash",
};

/** Nhãn hiển thị cho một shell dò được. Tên lạ trả về chính nó: bảng này là chỗ làm đẹp, không
 *  phải chỗ lọc. */
export function shellLabel(name: string): string {
  if (name.startsWith(WSL_PREFIX)) return `WSL: ${name.slice(WSL_PREFIX.length)}`;
  return LABELS[name] ?? name;
}
