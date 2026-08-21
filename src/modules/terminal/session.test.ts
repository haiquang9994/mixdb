import { describe, expect, it } from "vitest";
import { localTarget, terminalBadgeMarks, terminalTitle } from "./session";
import type { LocalChoice } from "./types";

const bash: LocalChoice = {
  shell: { name: "git-bash", path: "C:\\Program Files\\Git\\bin\\bash.exe", args: [] },
  cwd: null,
};

const ubuntu: LocalChoice = {
  shell: { name: "wsl:Ubuntu", path: "C:\\Windows\\System32\\wsl.exe", args: ["-d", "Ubuntu"] },
  cwd: "D:\\work",
};

describe("localTarget", () => {
  it("sends the path and the args, not the display name", () => {
    expect(localTarget(bash)).toEqual({
      type: "local",
      shell: "C:\\Program Files\\Git\\bin\\bash.exe",
      args: [],
      cwd: null,
    });
  });

  it("carries a WSL distribution through as arguments", () => {
    expect(localTarget(ubuntu)).toEqual({
      type: "local",
      shell: "C:\\Windows\\System32\\wsl.exe",
      args: ["-d", "Ubuntu"],
      cwd: "D:\\work",
    });
  });
});

describe("terminalTitle", () => {
  it("names the tab after the shell, not after its path", () => {
    expect(terminalTitle(bash)).toBe("Git Bash");
    expect(terminalTitle(ubuntu)).toBe("WSL: Ubuntu");
  });
});

describe("terminalBadgeMarks", () => {
  // Chưa có phiên thì form đang hiện, và form có thể là của một shell khác cái tab sẽ mở.
  it("marks nothing while the tab is still on the form", () => {
    expect(terminalBadgeMarks(false, false)).toEqual([]);
  });

  it("marks the session while it is running", () => {
    expect(terminalBadgeMarks(true, false)).toEqual([{ type: "local" }]);
  });

  it("puts the ended mark after the kind, never before it", () => {
    expect(terminalBadgeMarks(true, true)).toEqual([{ type: "local" }, { type: "ended" }]);
  });
});
