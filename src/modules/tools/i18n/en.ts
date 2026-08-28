/**
 * Module Tools gọi mọi thứ là gì.
 *
 * Dữ liệu thuần, không import gì từ `src/i18n/`: `dicts.ts` import file này, nên bất cứ thứ gì
 * import ngược ra từ đó sẽ khép vòng.
 */
const toolsEn = {
  toolbox: {
    newTabTitle: "Tools",
    list: "Tools",
    empty: "No tool is available yet.",
    groupData: "Data",
    groupEncode: "Encoding & IDs",
    groupTime: "Time",
    groupInfra: "Connection & infrastructure",
    groupText: "Text",
    copy: "Copy",
    copied: "Copied",
    input: "Input",
    output: "Output",
  },
};

export default toolsEn;
