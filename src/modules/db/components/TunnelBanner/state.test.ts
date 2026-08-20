import { describe, expect, it } from "vitest";
import { HIDDEN, nextBannerState, type BannerState } from "./state";

const reconnecting = { id: "a", state: "reconnecting" } as const;
const reconnected = { id: "a", state: "reconnected" } as const;
const failed = { id: "a", state: "failed", error: { code: "error.sshAuthFailed" } } as const;

describe("nextBannerState", () => {
  it("shows the loss, then the recovery, and the recovery is what the component hides again", () => {
    const losing = nextBannerState(HIDDEN, reconnecting);
    expect(losing).toEqual({ kind: "reconnecting" });
    expect(nextBannerState(losing, reconnected)).toEqual({ kind: "reconnected" });
  });

  it("says nothing about a recovery nobody saw the loss of", () => {
    // Một tab mở ra sau khi tunnel đã tự lành thì không có gì để trấn an ai cả.
    expect(nextBannerState(HIDDEN, reconnected)).toBe(HIDDEN);
  });

  it("keeps the same failure rather than replacing it", () => {
    // Watcher giãn nhịp và báo lại cùng một lỗi; nếu mỗi lần là một object mới thì mọi thứ React
    // gắn với object đó sẽ bị dựng lại theo nhịp backoff.
    const first = nextBannerState(HIDDEN, failed);
    expect(first).toEqual({ kind: "failed", error: { code: "error.sshAuthFailed" } });
    expect(nextBannerState(first, failed)).toBe(first);
  });

  it("replaces a failure when the reason changed", () => {
    const first = nextBannerState(HIDDEN, failed);
    const other = { id: "a", state: "failed", error: { code: "error.sshTimeout" } } as const;
    expect(nextBannerState(first, other)).toEqual({
      kind: "failed",
      error: { code: "error.sshTimeout" },
    });
  });

  it("clears a failure when the tunnel comes back, and when it is being tried again", () => {
    const first: BannerState = nextBannerState(HIDDEN, failed);
    expect(nextBannerState(first, reconnected)).toEqual({ kind: "reconnected" });
    expect(nextBannerState(first, reconnecting)).toEqual({ kind: "reconnecting" });
  });

  it("does not restart a reconnection that is already on screen", () => {
    const busy = nextBannerState(HIDDEN, reconnecting);
    expect(nextBannerState(busy, reconnecting)).toBe(busy);
  });
});
