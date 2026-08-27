import { describe, expect, it } from "vitest";
import { configFrom, formFrom, withKind } from "./connectionForm";
import { DEFAULT_PORTS, type ConnectionConfig } from "./types";

/* These two functions replaced two lists of seventeen setters that had to be kept in step by hand.
   What is checked here is what that hand-keeping used to get wrong: a field carried over from the
   connection before, and the asymmetry in `use_ssl`. */

const mysql: ConnectionConfig = {
  kind: "mysql",
  host: "db.example",
  port: 3306,
  username: "root",
  password: "hunter2",
  database: "shop",
  use_ssl: false,
};

describe("formFrom", () => {
  it("starts a new connection on MySQL's own port", () => {
    const form = formFrom(null);
    expect(form.kind).toBe("mysql");
    expect(form.port).toBe(DEFAULT_PORTS.mysql);
  });

  it("leaves nothing of a tunnel behind when the config has none", () => {
    // The bug this shape prevents: seventeen setters, one of them forgotten, and the form keeps
    // the previous connection's SSH passphrase under a host it was never typed for.
    const form = formFrom(mysql);
    expect(form.tunnelType).toBe("direct");
    expect(form).toMatchObject({
      sshHost: "",
      sshPort: 22,
      sshUser: "",
      sshAuthType: "password",
      sshPassword: "",
      sshKeyPath: "",
      sshPassphrase: "",
    });
  });

  it("reads a key-authenticated tunnel without leaving a password field set", () => {
    const form = formFrom({
      ...mysql,
      ssh: {
        host: "bastion",
        port: 2222,
        username: "ops",
        auth: { type: "privatekey", key_path: "/home/ops/.ssh/id_rsa", passphrase: "s3cret" },
      },
    });
    expect(form.tunnelType).toBe("ssh");
    expect(form.sshKeyPath).toBe("/home/ops/.ssh/id_rsa");
    expect(form.sshPassphrase).toBe("s3cret");
    expect(form.sshPassword).toBe("");
  });

  it("reads an absent use_ssl as on, for a kind that has the box", () => {
    // `use_ssl == Some(false)` is the only thing that turns TLS off in the backend, so an entry
    // saved before the box existed has to come back ticked.
    const { use_ssl: _dropped, ...withoutSsl } = mysql;
    expect(formFrom(withoutSsl).useSsl).toBe(true);
  });

  it("reads it as off for a kind that has no box at all", () => {
    // Otherwise loading a Mongo connection and switching the form to MySQL arrives with TLS
    // silently ticked — a form the user never set that way.
    expect(formFrom({ kind: "mongo", host: "", port: 27017, uri: "mongodb://h/db" }).useSsl).toBe(false);
    expect(formFrom({ kind: "redis", host: "127.0.0.1", port: 6379 }).useSsl).toBe(false);
  });

  it("starts a saved connection string hidden, and an empty one open", () => {
    expect(formFrom({ kind: "mongo", host: "", port: 27017, uri: "mongodb://h/db" }).uriRevealed).toBe(false);
    expect(formFrom(null).uriRevealed).toBe(true);
  });
});

describe("configFrom", () => {
  it("gives back what it was read from", () => {
    expect(configFrom(formFrom(mysql))).toEqual(mysql);
  });

  it("gives back a tunnelled connection unchanged too", () => {
    const tunnelled: ConnectionConfig = {
      ...mysql,
      ssh: { host: "bastion", port: 2222, username: "ops", auth: { type: "password", password: "pw" } },
    };
    expect(configFrom(formFrom(tunnelled))).toEqual(tunnelled);
  });

  it("drops an empty field rather than saving an empty string", () => {
    const form = { ...formFrom(null), host: "h", username: "", password: "", database: "" };
    const config = configFrom(form);
    expect(config.username).toBeUndefined();
    expect(config.password).toBeUndefined();
    expect(config.database).toBeUndefined();
  });

  it("keeps Mongo's per-field values out entirely — the string carries all of it", () => {
    const form = {
      ...formFrom(null),
      kind: "mongo" as const,
      username: "left",
      password: "over",
      database: "fields",
      uri: "  mongodb://h/db  ",
    };
    const config = configFrom(form);
    expect(config.uri).toBe("mongodb://h/db");
    expect(config.username).toBeUndefined();
    expect(config.password).toBeUndefined();
    expect(config.database).toBeUndefined();
    expect(config.use_ssl).toBeUndefined();
  });

  it("keeps the connection string out of every other kind", () => {
    expect(configFrom({ ...formFrom(null), uri: "mongodb://h/db" }).uri).toBeUndefined();
  });
});

describe("withKind", () => {
  it("moves the port with the kind", () => {
    // A port left at MySQL's 3306 while the tab says Postgres fails for a reason the form is
    // showing and nobody reads.
    expect(withKind(formFrom(null), "postgres").port).toBe(DEFAULT_PORTS.postgres);
    expect(withKind(formFrom(null), "redis").port).toBe(DEFAULT_PORTS.redis);
  });

  it("changes nothing else", () => {
    const form = { ...formFrom(null), username: "root", sshHost: "bastion" };
    const next = withKind(form, "postgres");
    expect(next.username).toBe("root");
    expect(next.sshHost).toBe("bastion");
  });
});
