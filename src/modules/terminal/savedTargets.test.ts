import { describe, expect, it } from "vitest";
import { mergeSecrets, parseSavedTarget, splitSecrets, withoutSecrets } from "./savedTargets";
import type { SavedTarget, SshConfig } from "./types";

const withPassword: SshConfig = {
  host: "example.com",
  port: 22,
  username: "deploy",
  auth: { type: "password", password: "hunter2" },
};

const withKey: SshConfig = {
  host: "example.com",
  port: 2222,
  username: "deploy",
  auth: { type: "privatekey", key_path: "/home/me/.ssh/id_ed25519", passphrase: "let me in" },
};

describe("splitSecrets", () => {
  it("takes the password out of what goes to the file", () => {
    const { config, secrets } = splitSecrets(withPassword);
    expect(secrets).toEqual({ sshPassword: "hunter2" });
    expect(config.auth).toEqual({ type: "password", password: "" });
  });

  it("keeps the key's path and takes only the passphrase", () => {
    const { config, secrets } = splitSecrets(withKey);
    expect(secrets).toEqual({ sshPassphrase: "let me in" });
    expect(config.auth).toEqual({
      type: "privatekey",
      key_path: "/home/me/.ssh/id_ed25519",
      passphrase: undefined,
    });
  });

  /* A key with no passphrase must not leave an empty entry behind: `secrets_save` deletes the
     entry when handed nothing, which is exactly what should happen. */
  it("makes no secret out of nothing to hide", () => {
    const noPassphrase: SshConfig = {
      ...withKey,
      auth: { type: "privatekey", key_path: "/k", passphrase: "" },
    };
    expect(splitSecrets(noPassphrase).secrets).toEqual({});
  });

  it("leaves the host, the port and the user alone", () => {
    const { config } = splitSecrets(withKey);
    expect(config.host).toBe("example.com");
    expect(config.port).toBe(2222);
    expect(config.username).toBe("deploy");
  });
});

describe("mergeSecrets", () => {
  it("puts the password back where it came from", () => {
    const { config, secrets } = splitSecrets(withPassword);
    expect(mergeSecrets(config, secrets)).toEqual(withPassword);
  });

  it("puts the passphrase back where it came from", () => {
    const { config, secrets } = splitSecrets(withKey);
    expect(mergeSecrets(config, secrets)).toEqual(withKey);
  });

  /* Someone cleared the entry out of Credential Manager, or copied `terminal-hosts.json` to
     another machine: the host still has to open in the form, only with an empty password box. */
  it("leaves the box empty when the credential store has nothing", () => {
    const { config } = splitSecrets(withPassword);
    expect(mergeSecrets(config, {})).toEqual({
      ...withPassword,
      auth: { type: "password", password: "" },
    });
  });
});

describe("parseSavedTarget", () => {
  it("reads a shell on this machine", () => {
    expect(
      parseSavedTarget({
        id: "t-1",
        name: "frontend",
        kind: "local",
        shellName: "wsl:Ubuntu",
        cwd: "D:\work",
        runOnConnect: "cd ~/a",
      }),
    ).toEqual({
      id: "t-1",
      name: "frontend",
      kind: "local",
      shellName: "wsl:Ubuntu",
      cwd: "D:\work",
      runOnConnect: "cd ~/a",
    });
  });

  /* Cùng luật với `tabState.ts`: không có thư mục bắt đầu là mở ở thư mục mặc định của shell. */
  it("reads an absent working directory as none", () => {
    const entry = parseSavedTarget({ id: "t-1", name: "a", kind: "local", shellName: "pwsh" });
    expect(entry).toEqual({
      id: "t-1",
      name: "a",
      kind: "local",
      shellName: "pwsh",
      cwd: null,
      runOnConnect: undefined,
    });
  });

  /* Entry của bản cũ, hồi danh sách chỉ có máy chủ. Không đoán gì cả: hồi ấy không có loại nào
     khác, nên `ssh` là cái nó vốn là. */
  it("reads an entry written before there were kinds as a server", () => {
    const entry = parseSavedTarget({ id: "h-1", name: "prod", config: withPassword });
    expect(entry).toEqual({
      id: "h-1",
      name: "prod",
      kind: "ssh",
      config: withPassword,
      runOnConnect: undefined,
    });
  });

  it("gives up on anything it cannot draw a row for", () => {
    expect(parseSavedTarget(null)).toBeNull();
    expect(parseSavedTarget("t-1")).toBeNull();
    expect(parseSavedTarget([])).toBeNull();
    expect(parseSavedTarget({ name: "a", config: withPassword })).toBeNull();
    expect(parseSavedTarget({ id: "", name: "a", config: withPassword })).toBeNull();
    expect(parseSavedTarget({ id: "t-1", config: withPassword })).toBeNull();
    // Một máy chủ không có `config` thì không có gì để kết nối tới.
    expect(parseSavedTarget({ id: "t-1", name: "a", kind: "ssh" })).toBeNull();
    // Một shell không có tên thì không tìm lại được trong danh sách shell của máy.
    expect(parseSavedTarget({ id: "t-1", name: "a", kind: "local" })).toBeNull();
    // Một loại phiên bản sau này thêm vào: bản này không vẽ nổi nó.
    expect(parseSavedTarget({ id: "t-1", name: "a", kind: "serial" })).toBeNull();
  });
});

describe("withoutSecrets", () => {
  it("takes the password out of a server on its way to the file", () => {
    const target: SavedTarget = { id: "h-1", name: "prod", kind: "ssh", config: withPassword };
    const stored = withoutSecrets(target);
    expect(stored.kind === "ssh" && stored.config.auth).toEqual({ type: "password", password: "" });
  });

  /* Một shell trên máy này không có gì để giấu, nên nó không đi vòng nào cả — và `savedTargets.ts`
     cũng không gọi keyring cho nó. */
  it("passes a local shell through untouched", () => {
    const target: SavedTarget = {
      id: "t-1",
      name: "frontend",
      kind: "local",
      shellName: "pwsh",
      cwd: null,
      runOnConnect: "npm run dev",
    };
    expect(withoutSecrets(target)).toBe(target);
  });
});
