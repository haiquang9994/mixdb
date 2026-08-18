import { describe, expect, it } from "vitest";
import { parseCurl, splitArgs } from "./parsePaste";

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

/** Ids in the order they were asked for, so a test can name the rows it expects. */
function ids(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

describe("parseCurl", () => {
  it("reads the plainest command there is", () => {
    const parsed = parseCurl("curl https://example.com/items", ids());
    expect(parsed).toEqual({
      method: "GET",
      url: "https://example.com/items",
      params: [],
      headers: [],
      body: { kind: "none" },
    });
  });

  it("is not a cURL command at all", () => {
    expect(parseCurl("wget https://example.com", ids())).toBeNull();
  });

  it("takes the method from -X, however it was written", () => {
    expect(parseCurl("curl -X post https://x", ids())?.method).toBe("POST");
    expect(parseCurl("curl -XPUT https://x", ids())?.method).toBe("PUT");
    expect(parseCurl("curl --request=PATCH https://x", ids())?.method).toBe("PATCH");
  });

  // The wire types name seven methods. A verb outside them is not one this client can send, so it
  // is left out rather than smuggled through as a string.
  it("ignores a verb this client has no name for", () => {
    expect(parseCurl("curl -X PROPFIND https://x", ids())?.method).toBe("GET");
  });

  it("reads headers into ticked rows, trimmed", () => {
    const parsed = parseCurl(
      "curl -H 'Accept: application/json' -H 'X-Token:abc' https://x",
      ids(),
    );
    expect(parsed?.headers).toEqual([
      { id: "id-1", enabled: true, key: "Accept", value: "application/json" },
      { id: "id-2", enabled: true, key: "X-Token", value: "abc" },
    ]);
  });

  it("keeps a header whose value has colons in it", () => {
    const parsed = parseCurl("curl -H 'X-When: 10:30:00' https://x", ids());
    expect(parsed?.headers[0].value).toBe("10:30:00");
  });

  it("passes over a header with no colon in it", () => {
    expect(parseCurl("curl -H 'Accept' https://x", ids())?.headers).toEqual([]);
  });

  it("takes the URL from --url", () => {
    expect(parseCurl("curl --url https://example.com/a https://decoy.example", ids())?.url).toBe(
      "https://example.com/a",
    );
  });

  it("prefers the argument that has a scheme", () => {
    expect(parseCurl("curl -o out.json https://example.com/a", ids())?.url).toBe(
      "https://example.com/a",
    );
  });

  it("takes a URL written without a scheme", () => {
    expect(parseCurl("curl example.com/items", ids())?.url).toBe("example.com/items");
    expect(parseCurl("curl localhost:3000/items", ids())?.url).toBe("localhost:3000/items");
  });

  it("ignores the flags that are this app's settings rather than this request's", () => {
    const parsed = parseCurl("curl -L -k --compressed https://x", ids());
    expect(parsed?.url).toBe("https://x");
    expect(parsed?.headers).toEqual([]);
  });

  it("splits the query into Params and leaves the box holding the whole URL", () => {
    const parsed = parseCurl("curl 'https://x/items?page=2&q=hello%20world'", ids());
    expect(parsed?.url).toBe("https://x/items?page=2&q=hello%20world");
    expect(parsed?.params).toEqual([
      { id: "id-1", enabled: true, key: "page", value: "2" },
      { id: "id-2", enabled: true, key: "q", value: "hello world" },
    ]);
  });

  // Phase 4 gives `{{var}}` a meaning. Until then it is text, and text is what must survive.
  it("leaves a variable in the URL exactly as it was written", () => {
    expect(parseCurl("curl '{{baseUrl}}/items' ", ids())?.url).toBe("{{baseUrl}}/items");
  });
});
