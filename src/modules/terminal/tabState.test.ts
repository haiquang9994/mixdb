import { describe, expect, it } from "vitest";
import { parseTerminalTabState, tabStateFor } from "./tabState";
import type { LocalShell, SshConfig } from "./types";

const SHELL: LocalShell = { name: "wsl:Ubuntu", path: "wsl.exe", args: ["-d", "Ubuntu"] };
const CONFIG: SshConfig = {
  host: "192.168.50.86",
  port: 22,
  username: "demo",
  auth: { type: "password", password: "demo" },
};

describe("parseTerminalTabState", () => {
  it("đọc lại được nhánh ssh", () => {
    expect(parseTerminalTabState({ kind: "ssh", hostId: "h-1" })).toEqual({
      kind: "ssh",
      hostId: "h-1",
    });
  });

  it("đọc lại được nhánh local", () => {
    expect(parseTerminalTabState({ kind: "local", shellName: "pwsh", cwd: "C:\src" })).toEqual({
      kind: "local",
      shellName: "pwsh",
      cwd: "C:\src",
    });
  });

  it("nhận shell không có thư mục bắt đầu, viết cách nào cũng được", () => {
    // So cả object chứ không `?.cwd`: `TerminalTabState` là union, nhánh `ssh` không có `cwd`.
    const expected = { kind: "local", shellName: "pwsh", cwd: null };
    expect(parseTerminalTabState({ kind: "local", shellName: "pwsh", cwd: null })).toEqual(expected);
    expect(parseTerminalTabState({ kind: "local", shellName: "pwsh" })).toEqual(expected);
  });

  it("không nói gì về tab chưa từng ghi", () => {
    expect(parseTerminalTabState(undefined)).toBeNull();
  });

  /* Tất cả những cái dưới đây là chuỗi một phiên bản nào đó của app đã ghi vào `localStorage`, nên
     không tin gì cả — shell cố ý đưa qua mà không nhìn. */
  it("bỏ qua mọi thứ không phải state của tab terminal", () => {
    expect(parseTerminalTabState(null)).toBeNull();
    expect(parseTerminalTabState("ssh")).toBeNull();
    expect(parseTerminalTabState([])).toBeNull();
    expect(parseTerminalTabState({})).toBeNull();
    expect(parseTerminalTabState({ kind: "telnet", hostId: "h-1" })).toBeNull();
    expect(parseTerminalTabState({ kind: "ssh" })).toBeNull();
    expect(parseTerminalTabState({ kind: "ssh", hostId: "" })).toBeNull();
    expect(parseTerminalTabState({ kind: "ssh", hostId: 7 })).toBeNull();
    expect(parseTerminalTabState({ kind: "local" })).toBeNull();
    expect(parseTerminalTabState({ kind: "local", shellName: "" })).toBeNull();
    expect(parseTerminalTabState({ kind: "local", shellName: "pwsh", cwd: 7 })).toBeNull();
  });
});

describe("tabStateFor", () => {
  it("giữ tên shell và thư mục bắt đầu, không giữ đường dẫn", () => {
    expect(tabStateFor({ kind: "local", shell: SHELL, cwd: "C:\src" })).toEqual({
      kind: "local",
      shellName: "wsl:Ubuntu",
      cwd: "C:\src",
    });
  });

  it("giữ id của host đã lưu, không giữ gì trong config", () => {
    expect(
      tabStateFor({ kind: "ssh", config: CONFIG, hostId: "h-1", runOnConnect: null }),
    ).toEqual({
      kind: "ssh",
      hostId: "h-1",
    });
  });

  /* Kể cả lệnh mở màn: nó thuộc về host trong `terminal-hosts.json`, và tab chỉ trỏ tới host. Chép
     ra đây là để hai bản của cùng một thứ trôi khỏi nhau — sửa lệnh xong, tab cũ vẫn chạy lệnh cũ. */
  it("không chép lệnh mở màn ra khỏi host", () => {
    expect(
      tabStateFor({ kind: "ssh", config: CONFIG, hostId: "h-1", runOnConnect: "cd ~/a" }),
    ).toEqual({
      kind: "ssh",
      hostId: "h-1",
    });
  });

  it("không nhớ gì về một phiên SSH gõ tay", () => {
    // Không có id để trỏ tới, và mật khẩu thì không được ghi ra — nên không ghi gì cả.
    expect(
      tabStateFor({ kind: "ssh", config: CONFIG, hostId: null, runOnConnect: null }),
    ).toBeUndefined();
  });
});
