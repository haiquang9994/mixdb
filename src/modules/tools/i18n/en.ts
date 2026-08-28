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

    ids: {
      label: "Id generator",
      kind: "Kind",
      count: "How many",
      generate: "Generate",
    },

    encode: {
      label: "Encode & hash",
      tabBase64: "Base64",
      tabHex: "Hex",
      tabUrl: "URL",
      tabHash: "Hash",
      encode: "Encode",
      decode: "Decode",
      hash: "Hash",
      urlSafe: "URL-safe alphabet",
      spaced: "Space the bytes",
      whole: "Whole URL (encodeURI)",
      algo: "Algorithm",
      md5Warning: "MD5 is broken. Use it to check existing data, never for passwords.",
      badInput: "That input could not be read in this format.",
    },

    jwt: {
      label: "JWT decoder",
      token: "Token",
      header: "Header",
      payload: "Payload",
      signature: "Signature",
      notVerified: "The signature is not checked. This only reads the token.",
      valid: "Still valid",
      expired: "Expired",
      expiresAt: "Expires at",
      issuedAt: "Issued at",
      notBefore: "Not before",
      badShape: "A token needs exactly three parts separated by dots.",
      badBase64: "That is not base64url.",
      badJson: "The base64 decoded, but what came out is not JSON.",
    },
  },
};

export default toolsEn;
