import { describe, expect, it } from "vitest";
import {
  addSaved,
  findRequest,
  isBlank,
  newRequest,
  removeRequest,
  sweepBlank,
  updateRequest,
} from "./requests";
import type { RequestLists } from "./types";

function lists(over: Partial<RequestLists> = {}): RequestLists {
  return { saved: [], recent: [], ...over };
}

describe("newRequest", () => {
  it("starts as a GET nobody has named, made by hand", () => {
    const req = newRequest("id-1", 1000);
    expect(req.id).toBe("id-1");
    expect(req.method).toBe("GET");
    expect(req.url).toBe("");
    expect(req.name).toBe("");
    expect(req.origin).toBe("manual");
    expect(req.body).toEqual({ kind: "none" });
    expect(req.auth).toEqual({ kind: "none" });
    expect(req.createdAt).toBe(1000);
    expect(req.lastUsedAt).toBe(1000);
  });

  it("starts with no rows in either table", () => {
    const req = newRequest("id-1", 1000);
    expect(req.params).toEqual([]);
    expect(req.headers).toEqual([]);
  });
});

describe("addSaved", () => {
  it("puts a new request at the top of Saved", () => {
    const a = newRequest("a", 1);
    const b = newRequest("b", 2);
    const after = addSaved(addSaved(lists(), a), b);
    expect(after.saved.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("leaves Recent alone", () => {
    const recent = [newRequest("r", 1)];
    expect(addSaved(lists({ recent }), newRequest("a", 2)).recent).toBe(recent);
  });
});

describe("updateRequest", () => {
  it("replaces the request in whichever group holds it", () => {
    const edited = { ...newRequest("r", 1), url: "https://example.com" };
    const after = updateRequest(lists({ recent: [newRequest("r", 1)] }), edited);
    expect(after.recent[0].url).toBe("https://example.com");
  });

  it("keeps the request where it was rather than promoting it", () => {
    const edited = { ...newRequest("r", 1), url: "https://example.com" };
    const after = updateRequest(lists({ recent: [newRequest("r", 1)] }), edited);
    expect(after.saved).toEqual([]);
  });

  // Drafts follow the request, and the request may have been dropped from Recent while a tab on
  // it was still open. Nothing to update is not an error — it is a tab outliving its row.
  it("changes nothing when the request is in neither group", () => {
    const before = lists({ saved: [newRequest("a", 1)] });
    expect(updateRequest(before, newRequest("ghost", 2))).toEqual(before);
  });
});

describe("removeRequest", () => {
  it("takes it out of Saved", () => {
    const after = removeRequest(lists({ saved: [newRequest("a", 1), newRequest("b", 2)] }), "a");
    expect(after.saved.map((r) => r.id)).toEqual(["b"]);
  });

  it("takes it out of Recent", () => {
    const after = removeRequest(lists({ recent: [newRequest("r", 1)] }), "r");
    expect(after.recent).toEqual([]);
  });
});

describe("findRequest", () => {
  it("looks in both groups", () => {
    const both = lists({ saved: [newRequest("a", 1)], recent: [newRequest("r", 2)] });
    expect(findRequest(both, "a")?.id).toBe("a");
    expect(findRequest(both, "r")?.id).toBe("r");
    expect(findRequest(both, "nope")).toBeUndefined();
  });
});

describe("isBlank", () => {
  it("calls a request nobody has touched blank", () => {
    expect(isBlank(newRequest("a", 1))).toBe(true);
  });

  it("is not fooled by a URL of nothing but spaces", () => {
    expect(isBlank({ ...newRequest("a", 1), url: "   " })).toBe(true);
  });

  it("keeps a request that has a name, and nothing else", () => {
    expect(isBlank({ ...newRequest("a", 1), name: "Placeholder" })).toBe(false);
  });

  it("keeps a request that has a URL", () => {
    expect(isBlank({ ...newRequest("a", 1), url: "https://example.com" })).toBe(false);
  });

  it("keeps a request whose method was changed", () => {
    expect(isBlank({ ...newRequest("a", 1), method: "POST" })).toBe(false);
  });

  it("keeps a request with anything typed into either table", () => {
    const row = { id: "r", enabled: true, key: "x", value: "" };
    expect(isBlank({ ...newRequest("a", 1), headers: [row] })).toBe(false);
    expect(isBlank({ ...newRequest("a", 1), params: [row] })).toBe(false);
  });

  it("does not count an emptied row as something typed", () => {
    const row = { id: "r", enabled: true, key: "", value: "" };
    expect(isBlank({ ...newRequest("a", 1), headers: [row] })).toBe(true);
  });

  it("keeps a request with a body, even an empty one", () => {
    const body = { kind: "raw", language: "json", text: "" } as const;
    expect(isBlank({ ...newRequest("a", 1), body })).toBe(false);
  });

  it("keeps a request with authentication set up", () => {
    const auth = { kind: "bearer", token: "" } as const;
    expect(isBlank({ ...newRequest("a", 1), auth })).toBe(false);
  });

  it("keeps a request that has been sent, whatever is left in it", () => {
    expect(isBlank({ ...newRequest("a", 1), lastUsedAt: 2 })).toBe(false);
  });
});

describe("sweepBlank", () => {
  it("drops the blank ones from both groups", () => {
    const blank = newRequest("blank", 1);
    const real = { ...newRequest("real", 1), url: "https://example.com" };
    const after = sweepBlank(lists({ saved: [blank, real], recent: [blank] }));
    expect(after.saved.map((r) => r.id)).toEqual(["real"]);
    expect(after.recent).toEqual([]);
  });

  it("hands back the very same lists when there is nothing to drop", () => {
    const before = lists({ saved: [{ ...newRequest("real", 1), url: "https://x" }] });
    expect(sweepBlank(before)).toBe(before);
  });
});
