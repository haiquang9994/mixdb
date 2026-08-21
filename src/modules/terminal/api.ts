import { invoke } from "@tauri-apps/api/core";
import type { LocalShell } from "./types";

/**
 * Chỗ duy nhất trong module này nói chuyện với native.
 *
 * Mọi lệnh reject bằng `AppError` — `{ code, params }` — và người gọi đưa qua `errorMessage(t, e)`
 * chứ không hiện thẳng.
 */

/** Máy này mở được shell nào; thứ tự là thứ tự gợi ý, cái đầu tiên là mặc định. */
export function localShells(): Promise<LocalShell[]> {
  return invoke<LocalShell[]>("terminal_local_shells");
}
