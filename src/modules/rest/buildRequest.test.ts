import { describe, expect, it } from "vitest";
import { PHASE_ONE_SETTINGS, buildRequest } from "./buildRequest";
import { newRequest } from "./requests";
import type { KeyValue, RestRequest } from "./types";

function row(over: Partial<KeyValue> & { id: string }): KeyValue {
  return { enabled: true, key: "", value: "", ...over };
}

function request(over: Partial<RestRequest> = {}): RestRequest {
  return { ...newRequest("r", 0), url: "https://x.test/a", ...over };
}

const build = (over: Partial<RestRequest> = {}) =>
  buildRequest(request(over), "send-1", PHASE_ONE_SETTINGS);

/** The header's value, whatever case it was written in. */
function header(wire: ReturnType<typeof build>, name: string): string | undefined {
  return wire.headers.find(([key]) => key.toLowerCase() === name)?.[1];
}

describe("buildRequest: the envelope", () => {
  it("carries the id the caller will cancel by", () => {
    expect(build().request_id).toBe("send-1");
  });

  it("carries the method", () => {
    expect(build({ method: "DELETE" }).method).toBe("DELETE");
  });

  it("carries Phase 1's hardcoded send settings", () => {
    const wire = build();
    expect(wire.timeout_ms).toBe(30_000);
    expect(wire.follow_redirects).toBe(true);
    expect(wire.accept_invalid_certs).toBe(false);
  });

  it("folds the Params table into the URL", () => {
    const wire = build({ params: [row({ id: "a", key: "page", value: "2" })] });
    expect(wire.url).toBe("https://x.test/a?page=2");
  });

  it("leaves the unticked headers out", () => {
    const wire = build({
      headers: [row({ id: "a", enabled: false, key: "X-Debug", value: "1" })],
    });
    expect(wire.headers).toEqual([]);
  });

  it("leaves out the empty row at the foot of the table", () => {
    const wire = build({ headers: [row({ id: "a", key: "", value: "" })] });
    expect(wire.headers).toEqual([]);
  });

  it("keeps a header repeated twice, twice", () => {
    const wire = build({
      headers: [row({ id: "a", key: "Cookie", value: "x=1" }), row({ id: "b", key: "Cookie", value: "y=2" })],
    });
    expect(wire.headers).toEqual([["Cookie", "x=1"], ["Cookie", "y=2"]]);
  });
});

describe("buildRequest: bodies", () => {
  it("sends nothing, and declares nothing, for no body", () => {
    const wire = build();
    expect(wire.body).toEqual({ kind: "none" });
    expect(header(wire, "content-type")).toBeUndefined();
  });

  it("sends a raw body as text", () => {
    const wire = build({ body: { kind: "raw", language: "json", text: '{"a":1}' } });
    expect(wire.body).toEqual({ kind: "text", text: '{"a":1}' });
  });

  it("declares a content type for each raw language", () => {
    const of = (language: "json" | "xml" | "html" | "text") =>
      header(build({ body: { kind: "raw", language, text: "x" } }), "content-type");
    expect(of("json")).toBe("application/json");
    expect(of("xml")).toBe("application/xml");
    expect(of("html")).toBe("text/html");
    expect(of("text")).toBe("text/plain");
  });

  // A content type the user typed is the one they meant — a REST client that overrides it is
  // one you cannot use to reproduce a bug.
  it("does not override a content type the user set", () => {
    const wire = build({
      headers: [row({ id: "a", key: "content-type", value: "application/vnd.api+json" })],
      body: { kind: "raw", language: "json", text: "{}" },
    });
    expect(wire.headers.filter(([key]) => key.toLowerCase() === "content-type")).toHaveLength(1);
    expect(header(wire, "content-type")).toBe("application/vnd.api+json");
  });

  it("encodes a form body and declares it", () => {
    const wire = build({
      body: {
        kind: "form",
        fields: [row({ id: "a", key: "name", value: "a b" }), row({ id: "b", key: "x", value: "1" })],
      },
    });
    expect(wire.body).toEqual({ kind: "text", text: "name=a%20b&x=1" });
    expect(header(wire, "content-type")).toBe("application/x-www-form-urlencoded");
  });

  it("leaves unticked form fields out", () => {
    const wire = build({
      body: { kind: "form", fields: [row({ id: "a", enabled: false, key: "x", value: "1" })] },
    });
    expect(wire.body).toEqual({ kind: "text", text: "" });
  });

  it("turns multipart fields into parts, text and file alike", () => {
    const wire = build({
      body: {
        kind: "multipart",
        fields: [
          row({ id: "a", key: "note", value: "hi" }),
          { ...row({ id: "b", key: "avatar" }), file: "C:/tmp/a.png" },
        ],
      },
    });
    expect(wire.body).toEqual({
      kind: "multipart",
      parts: [
        { name: "note", value: "hi", path: null },
        { name: "avatar", value: null, path: "C:/tmp/a.png" },
      ],
    });
  });

  // reqwest writes the boundary into the header itself, and a boundary guessed here would not
  // match the one it generates.
  it("declares nothing for multipart", () => {
    const wire = build({ body: { kind: "multipart", fields: [] } });
    expect(header(wire, "content-type")).toBeUndefined();
  });

  it("sends a binary body as a path for Rust to read", () => {
    const wire = build({ body: { kind: "binary", filePath: "C:/tmp/a.bin" } });
    expect(wire.body).toEqual({ kind: "file", path: "C:/tmp/a.bin" });
    expect(header(wire, "content-type")).toBeUndefined();
  });
});
