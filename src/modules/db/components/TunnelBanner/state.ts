import type { AppError } from "../../../../core/errors";
import type { TunnelState } from "../../tunnel";

/**
 * Banner đang nói gì, nếu có nói gì.
 *
 * Tách khỏi component vì đây là chỗ duy nhất có gì để sai: thứ tự các sự kiện tới, và cái nào được
 * phép thay cái nào.
 */
export type BannerState =
  | { kind: "hidden" }
  | { kind: "reconnecting" }
  | { kind: "reconnected" }
  | { kind: "failed"; error: AppError };

export const HIDDEN: BannerState = { kind: "hidden" };

/** Trạng thái kế tiếp của banner. Trả lại chính `current` khi không có gì mới để nói. */
export function nextBannerState(current: BannerState, event: TunnelState): BannerState {
  switch (event.state) {
    case "reconnecting":
      return current.kind === "reconnecting" ? current : { kind: "reconnecting" };
    case "reconnected":
      // Chưa từng hiện gì thì không có gì để trấn an: một tab mở ra sau khi tunnel đã tự lành
      // không có lý do gì để báo "đã kết nối lại".
      return current.kind === "hidden" ? current : { kind: "reconnected" };
    case "failed": {
      const error = event.error ?? { code: "error.sshUnavailable" };
      // Cùng một lỗi lặp lại là nhịp backoff của watcher, không phải tin mới. Giữ nguyên object để
      // không có gì bên React bị dựng lại mỗi phút.
      if (current.kind === "failed" && current.error.code === error.code) return current;
      return { kind: "failed", error };
    }
  }
}
