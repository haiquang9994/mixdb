/**
 * Module Tools gọi mọi thứ là gì, bằng tiếng Việt.
 *
 * Dữ liệu thuần, không import gì từ `src/i18n/`: `dicts.ts` import file này, nên bất cứ thứ gì
 * import ngược ra từ đó sẽ khép vòng.
 */
const toolsVi = {
  toolbox: {
    newTabTitle: "Công cụ",
    list: "Công cụ",
    empty: "Chưa có công cụ nào.",
    groupData: "Dữ liệu",
    groupEncode: "Mã hoá & ID",
    groupTime: "Thời gian",
    groupInfra: "Kết nối & hạ tầng",
    groupText: "Văn bản",
    copy: "Chép",
    copied: "Đã chép",
    input: "Đầu vào",
    output: "Đầu ra",

    timestamp: {
      label: "Mốc thời gian",
      value: "Mốc thời gian hoặc ngày giờ",
      placeholder: "1787875200 hoặc 2026-08-28T00:00:00Z",
      now: "Bây giờ",
      timeZone: "Múi giờ",
      guessedSeconds: "Đọc là Unix giây.",
      guessedMillis: "Đọc là Unix mili giây.",
      guessedMicros: "Đọc là Unix micro giây.",
      guessedIso: "Đọc là ngày giờ ISO 8601.",
      unreadable: "Không phải mốc thời gian hay ngày giờ ISO 8601.",
      isoUtc: "ISO 8601 (UTC)",
      isoLocal: "Theo múi giờ đã chọn",
      unixSeconds: "Unix giây",
      unixMillis: "Unix mili giây",
      relative: "Tương đối",
    },

    case: {
      label: "Đổi kiểu chữ",
      style: "Kiểu",
      placeholder: "Mỗi dòng một tên — dán thẳng cả danh sách cột vào đây.",
    },
  },
};

export default toolsVi;
