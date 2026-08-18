import { describe, expect, it } from "vitest";
import { splitArgs } from "./parsePaste";

describe("splitArgs", () => {
  it("cuts a command on whitespace", () => {
    expect(splitArgs("curl -X POST https://example.com")).toEqual([
      "curl",
      "-X",
      "POST",
      "https://example.com",
    ]);
  });

  it("keeps a single-quoted argument whole", () => {
    expect(splitArgs("curl -H 'Accept: application/json' https://x")).toEqual([
      "curl",
      "-H",
      "Accept: application/json",
      "https://x",
    ]);
  });

  it("takes a backslash inside single quotes literally", () => {
    expect(splitArgs(String.raw`curl -d 'a\b'`)).toEqual(["curl", "-d", String.raw`a\b`]);
  });

  it("unescapes a quote inside double quotes", () => {
    expect(splitArgs(String.raw`curl -d "{\"a\":1}"`)).toEqual(["curl", "-d", '{"a":1}']);
  });

  it("joins the lines of a command broken with backslashes", () => {
    const command = ["curl \\", "  -X POST \\", "  https://x"].join("\n");
    expect(splitArgs(command)).toEqual(["curl", "-X", "POST", "https://x"]);
  });

  it("joins the lines of a command broken the way cmd.exe breaks them", () => {
    expect(splitArgs("curl ^\n  -X POST ^\n  https://x")).toEqual([
      "curl",
      "-X",
      "POST",
      "https://x",
    ]);
  });

  it("keeps an argument quoted down to nothing", () => {
    expect(splitArgs("curl -d '' https://x")).toEqual(["curl", "-d", "", "https://x"]);
  });

  it("glues the quoted and unquoted halves of one word together", () => {
    expect(splitArgs("curl 'https://x'/path")).toEqual(["curl", "https://x/path"]);
  });

  // Someone pasted half a command, or a command whose quoting was already broken. Half an argument
  // is a better answer than none.
  it("takes an unclosed quote as the rest of the text", () => {
    expect(splitArgs("curl -d 'oops")).toEqual(["curl", "-d", "oops"]);
  });
});
