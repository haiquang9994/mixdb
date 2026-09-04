import { error as pluginError } from "@tauri-apps/plugin-log";

/**
 * Một dòng log cho một lỗi không bắt được, kèm nguồn (`"react"` từ Error Boundary, `"window"` từ
 * `window.onerror`, `"promise"` từ `unhandledrejection`) và ngữ cảnh nếu có (ví dụ
 * `ErrorInfo.componentStack` của React).
 *
 * Hàm thuần, tách khỏi việc ghi thật (`logError`) để test được không cần mock IPC của Tauri.
 */
export function formatLogMessage(source: string, error: unknown, context?: string): string {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return `[${source}] ${message}${context ? `\n${context}` : ""}`;
}

/**
 * Ghi một lỗi không bắt được ra file log của app (`tauri-plugin-log`, thư mục `appLogDir()`).
 *
 * Nuốt lỗi của chính việc ghi log — một crash log gãy không được phép thành crash thứ hai. Khi đó
 * `console.error` là chỗ duy nhất còn lại, dù chỉ ai mở devtools mới thấy.
 */
export async function logError(source: string, error: unknown, context?: string): Promise<void> {
  try {
    await pluginError(formatLogMessage(source, error, context));
  } catch {
    console.error(source, error);
  }
}
