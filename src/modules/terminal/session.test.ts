import { describe, expect, it } from "vitest";
import {
  openingKeystrokes,
  terminalBadgeMarks,
  terminalTarget,
  terminalTitle,
} from "./session";
import type { SshConfig, TerminalChoice } from "./types";

const bash: TerminalChoice = {
  kind: "local",
  shell: { name: "git-bash", path: "C:\\Program Files\\Git\\bin\\bash.exe", args: [] },
  cwd: null,
  targetId: null,
  runOnConnect: null,
};

const ubuntu: TerminalChoice = {
  kind: "local",
  shell: { name: "wsl:Ubuntu", path: "C:\\Windows\\System32\\wsl.exe", args: ["-d", "Ubuntu"] },
  cwd: "D:\\work",
  targetId: null,
  runOnConnect: null,
};

const config: SshConfig = {
  host: "example.com",
  port: 22,
  username: "deploy",
  auth: { type: "password", password: "hunter2" },
};

const remote: TerminalChoice = { kind: "ssh", config, targetId: null, runOnConnect: null };

describe("terminalTarget", () => {
  it("sends the path and the args, not the display name", () => {
    expect(terminalTarget(bash)).toEqual({
      type: "local",
      shell: "C:\\Program Files\\Git\\bin\\bash.exe",
      args: [],
      cwd: null,
    });
  });

  it("carries a WSL distribution through as arguments", () => {
    expect(terminalTarget(ubuntu)).toEqual({
      type: "local",
      shell: "C:\\Windows\\System32\\wsl.exe",
      args: ["-d", "Ubuntu"],
      cwd: "D:\\work",
    });
  });

  /* `Ssh(SshConfig)` on the Rust side is a newtype variant of an internally tagged enum, so its
     four fields sit flat beside `type` rather than nested under a key of their own. Getting this
     wrong makes serde refuse the payload at runtime, where nothing at build time would say so. */
  it("flattens the SSH config beside the target tag", () => {
    expect(terminalTarget(remote)).toEqual({
      type: "ssh",
      host: "example.com",
      port: 22,
      username: "deploy",
      auth: { type: "password", password: "hunter2" },
    });
  });
});

describe("terminalTitle", () => {
  it("names the tab after the shell, not after its path", () => {
    expect(terminalTitle(bash)).toBe("Git Bash");
    expect(terminalTitle(ubuntu)).toBe("WSL: Ubuntu");
  });

  /* `user@host`, not the saved host's name: a tab is a few characters wide, and what has to be
     readable there is which machine the keystrokes are going to. */
  it("names an SSH session after user@host", () => {
    expect(terminalTitle(remote)).toBe("deploy@example.com");
  });
});

describe("terminalBadgeMarks", () => {
  // Chưa có phiên thì form đang hiện, và form có thể là của một shell khác cái tab sẽ mở.
  it("marks nothing while the tab is still on the form", () => {
    expect(terminalBadgeMarks(null, false)).toEqual([]);
  });

  it("marks the session while it is running", () => {
    expect(terminalBadgeMarks(bash, false)).toEqual([{ type: "local" }]);
  });

  it("tells an SSH session apart from a local one", () => {
    expect(terminalBadgeMarks(remote, false)).toEqual([{ type: "ssh" }]);
  });

  it("puts the ended mark after the kind, never before it", () => {
    expect(terminalBadgeMarks(remote, true)).toEqual([{ type: "ssh" }, { type: "ended" }]);
  });
});

describe("openingKeystrokes", () => {
  it("ends the line, because a command nobody pressed Enter on never runs", () => {
    expect(openingKeystrokes("cd ~/project-a/frontend")).toBe("cd ~/project-a/frontend\r");
  });

  /* Mấy dòng là mấy lệnh, và người dùng gõ chúng vào một ô nhiều dòng vì họ muốn từng dòng chạy —
     `\r` chứ không phải `\n`: pty đọc phím Enter, không đọc ký tự xuống dòng. */
  it("runs every line, however the box wrote its newlines", () => {
    expect(openingKeystrokes("cd ~/a\nnvm use\r\nnpm run dev")).toBe(
      "cd ~/a\rnvm use\rnpm run dev\r",
    );
  });

  it("drops blank lines and the spaces around each one", () => {
    expect(openingKeystrokes("  cd ~/a  \n\n\n  ls  \n")).toBe("cd ~/a\rls\r");
  });

  /* Ô trống là chuyện thường tình, không phải một lệnh rỗng để gửi xuống. */
  it("has nothing to send for an empty box", () => {
    expect(openingKeystrokes(null)).toBeNull();
    expect(openingKeystrokes("")).toBeNull();
    expect(openingKeystrokes("   \n\n  ")).toBeNull();
  });
});
