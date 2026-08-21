import type { ShortcutGroup } from "../../core/shortcuts";

/**
 * Phím tắt của module terminal, đưa cho shell qua `ModuleDefinition.shortcuts` — y như
 * `REST_SHORTCUTS`.
 *
 * Ngắn có chủ ý: mọi chord không có tên ở đây đều là của shell. Dán không có mặt vì nó không có
 * handler nào — xem `keys.ts`.
 */
export const TERMINAL_SHORTCUTS: ShortcutGroup[] = [
  {
    scope: "terminal",
    labelKey: "terminal.shortcutScope",
    defs: [
      /* Cùng `Ctrl/Cmd+C` với lệnh huỷ của shell, và cách phân xử nằm ở chỗ `TerminalView` chỉ
         đăng ký nó khi đang có vùng chọn: có thì chép, không thì phím rơi xuống shell nguyên vẹn.
         Trên macOS câu hỏi không đặt ra — `Cmd+C` mới là chord này, `Ctrl+C` không mang phím tắt
         nào cả. */
      { id: "terminal.copy", chord: { key: "c" }, labelKey: "terminal.shortcutCopy" },
      /* Lại `Ctrl/Cmd+C`, và cũng không đụng ai: nó chỉ được đăng ký sau khi phiên đã kết thúc,
         lúc mà không còn shell nào để huỷ. Cùng một phím, và đó là chủ ý — khi màn hình đã đứng
         im, cái người ta gõ theo phản xạ để thoát ra vẫn là nó. */
      { id: "terminal.dismiss", chord: { key: "c" }, labelKey: "terminal.shortcutDismiss" },
      /* `Ctrl/Cmd` với `+` và `-`, đúng chỗ mọi trình duyệt và mọi terminal khác để nó. Ba cách gõ
         cho một cử chỉ, nên `alias` — xem `ShortcutDef.alias`; ở đây `+` không shift là phím của
         bàn phím số, còn `+` có shift là phím `=` khi shift thật sự được giữ. */
      {
        id: "terminal.zoomIn",
        chord: { key: "=" },
        alias: [{ key: "+" }, { key: "+", shift: true }],
        labelKey: "terminal.shortcutZoomIn",
      },
      {
        id: "terminal.zoomOut",
        chord: { key: "-" },
        alias: [{ key: "_", shift: true }],
        labelKey: "terminal.shortcutZoomOut",
      },
    ],
  },
];
