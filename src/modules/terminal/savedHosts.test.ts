import { describe, expect, it } from "vitest";
import { mergeSecrets, splitSecrets } from "./savedHosts";
import type { SshConfig } from "./types";

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
