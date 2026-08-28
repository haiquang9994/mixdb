export type CaseStyle = "camel" | "snake" | "kebab" | "pascal" | "constant" | "dot" | "title";

export const CASE_STYLES: CaseStyle[] = [
  "camel",
  "snake",
  "kebab",
  "pascal",
  "constant",
  "dot",
  "title",
];

/**
 * Một chuỗi tách thành các từ viết thường.
 *
 * Thứ tự ba phép thay là quan trọng và đã được test khoá lại:
 *
 * 1. Chèn khoảng trắng trước chữ số — `user2FA` thành `user 2FA`, chứ không phải `user2 FA`.
 * 2. Tách thường-rồi-hoa — `fooBar` thành `foo Bar`. Cố tình **không** nhận `0-9` ở vế trái, nếu
 *    không thì `2FA` vừa ghép lại sẽ bị xé ra ngay.
 * 3. Tách cụm hoa khỏi từ theo sau — `HTTPResponse` thành `HTTP Response`, thứ mà một phép tách
 *    hoa-thường ngây thơ biến thành `h_t_t_p_response`.
 */
export function splitWords(input: string): string[] {
  return input
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
}

const upperFirst = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** Một dòng đổi sang một kiểu. Dòng không có từ nào trả về nguyên trạng — xoá trắng một dòng
 *  người dùng vừa dán vào là mất dữ liệu, dù chỉ là một dòng cách. */
export function convert(line: string, style: CaseStyle): string {
  const words = splitWords(line);
  if (words.length === 0) return line;

  switch (style) {
    case "camel":
      return words[0] + words.slice(1).map(upperFirst).join("");
    case "snake":
      return words.join("_");
    case "kebab":
      return words.join("-");
    case "pascal":
      return words.map(upperFirst).join("");
    case "constant":
      return words.join("_").toUpperCase();
    case "dot":
      return words.join(".");
    case "title":
      return words.map(upperFirst).join(" ");
  }
}
