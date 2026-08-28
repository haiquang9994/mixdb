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
  },
};

export default toolsVi;
