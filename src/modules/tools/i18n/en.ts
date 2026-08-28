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

    timestamp: {
      label: "Timestamp",
      value: "Timestamp or date",
      placeholder: "1787875200 or 2026-08-28T00:00:00Z",
      now: "Now",
      timeZone: "Time zone",
      guessedSeconds: "Read as Unix seconds.",
      guessedMillis: "Read as Unix milliseconds.",
      guessedMicros: "Read as Unix microseconds.",
      guessedIso: "Read as an ISO 8601 date.",
      unreadable: "Not a timestamp or an ISO 8601 date.",
      isoUtc: "ISO 8601 (UTC)",
      isoLocal: "In the chosen zone",
      unixSeconds: "Unix seconds",
      unixMillis: "Unix milliseconds",
      relative: "Relative",
    },

    case: {
      label: "Case converter",
      style: "Style",
      placeholder: "One name per line — paste a column list straight in.",
    },
  },
};

export default toolsEn;
