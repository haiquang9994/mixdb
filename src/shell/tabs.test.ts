import { describe, expect, it } from "vitest";
import { rebadgeTab, retitleTab, type TabInfo } from "./tabs";

const TABS: TabInfo[] = [
  { id: "a", moduleId: "db", title: "Kết nối mới", badges: [] },
  { id: "b", moduleId: "rest", title: "Yêu cầu mới", badges: [] },
];

describe("retitleTab", () => {
  it("hands back the very same array when the title has not moved", () => {
    expect(retitleTab(TABS, "b", "Yêu cầu mới")).toBe(TABS);
  });

  it("hands back the very same array when no tab has that id", () => {
    expect(retitleTab(TABS, "zzz", "gì đó")).toBe(TABS);
  });

  it("renames the one tab and leaves its neighbour untouched", () => {
    const next = retitleTab(TABS, "b", "GET /users");
    expect(next).not.toBe(TABS);
    expect(next[1].title).toBe("GET /users");
    expect(next[0]).toBe(TABS[0]);
  });
});

describe("rebadgeTab", () => {
  it("hands back the very same array when the badges are the same list", () => {
    expect(rebadgeTab(TABS, "a", TABS[0].badges)).toBe(TABS);
  });

  it("hands back the very same array when no tab has that id", () => {
    expect(rebadgeTab(TABS, "zzz", [])).toBe(TABS);
  });

  it("replaces the badges of the one tab", () => {
    const badges = [{ id: "readOnly", icon: null, label: "Chỉ đọc" }];
    const next = rebadgeTab(TABS, "a", badges);
    expect(next).not.toBe(TABS);
    expect(next[0].badges).toBe(badges);
    expect(next[1]).toBe(TABS[1]);
  });
});
