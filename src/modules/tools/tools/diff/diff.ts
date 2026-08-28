/**
 * So sánh hai đoạn văn bản theo dòng.
 *
 * LCS là O(n×m) cả thời gian lẫn bộ nhớ, và bộ nhớ mới là chỗ đau: một bảng 5000×5000 ô 4 byte là
 * 95 MB cho một lần bấm. Nên **cắt phần đầu và phần đuôi giống nhau trước**, rồi mới chạy LCS trên
 * phần giữa, và chặn phần giữa lại. Mười dòng khác nhau giữa hai file 50 nghìn dòng thì bảng chỉ
 * còn 10×10.
 */

export interface DiffLine {
  kind: "same" | "add" | "remove";
  /** Số dòng ở mỗi bên, hoặc `null` nếu dòng không tồn tại bên đó. */
  leftNo: number | null;
  rightNo: number | null;
  text: string;
}

export interface DiffOptions {
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
}

export type DiffResult =
  | { ok: true; lines: DiffLine[]; added: number; removed: number }
  | { ok: false; reason: "tooLarge" };

/** 2000×2000 ô 4 byte là 16 MB — chấp nhận được cho một lần bấm. */
const MAX_MIDDLE = 2000;

function keyOf(line: string, options: DiffOptions): string {
  const text = options.ignoreWhitespace ? line.replace(/\s+/g, " ").trim() : line;
  return options.ignoreCase ? text.toLowerCase() : text;
}

export function diffLines(left: string, right: string, options: DiffOptions): DiffResult {
  const a = left.split("\n");
  const b = right.split("\n");
  const ka = a.map((line) => keyOf(line, options));
  const kb = b.map((line) => keyOf(line, options));

  let head = 0;
  while (head < a.length && head < b.length && ka[head] === kb[head]) head += 1;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    ka[a.length - 1 - tail] === kb[b.length - 1 - tail]
  ) {
    tail += 1;
  }

  const midA = a.length - head - tail;
  const midB = b.length - head - tail;
  if (midA > MAX_MIDDLE || midB > MAX_MIDDLE) return { ok: false, reason: "tooLarge" };

  // Bảng LCS chạy ngược từ cuối, nên ô (i, j) là độ dài chuỗi chung của hai phần đuôi.
  const width = midB + 1;
  const table = new Uint32Array((midA + 1) * width);
  const at = (i: number, j: number): number => i * width + j;
  for (let i = midA - 1; i >= 0; i -= 1) {
    for (let j = midB - 1; j >= 0; j -= 1) {
      table[at(i, j)] =
        ka[head + i] === kb[head + j]
          ? table[at(i + 1, j + 1)]! + 1
          : Math.max(table[at(i + 1, j)]!, table[at(i, j + 1)]!);
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;

  for (let k = 0; k < head; k += 1) {
    lines.push({ kind: "same", leftNo: k + 1, rightNo: k + 1, text: a[k]! });
  }

  let i = 0;
  let j = 0;
  while (i < midA && j < midB) {
    if (ka[head + i] === kb[head + j]) {
      lines.push({ kind: "same", leftNo: head + i + 1, rightNo: head + j + 1, text: a[head + i]! });
      i += 1;
      j += 1;
    } else if (table[at(i + 1, j)]! >= table[at(i, j + 1)]!) {
      lines.push({ kind: "remove", leftNo: head + i + 1, rightNo: null, text: a[head + i]! });
      removed += 1;
      i += 1;
    } else {
      lines.push({ kind: "add", leftNo: null, rightNo: head + j + 1, text: b[head + j]! });
      added += 1;
      j += 1;
    }
  }
  while (i < midA) {
    lines.push({ kind: "remove", leftNo: head + i + 1, rightNo: null, text: a[head + i]! });
    removed += 1;
    i += 1;
  }
  while (j < midB) {
    lines.push({ kind: "add", leftNo: null, rightNo: head + j + 1, text: b[head + j]! });
    added += 1;
    j += 1;
  }

  for (let k = 0; k < tail; k += 1) {
    const li = a.length - tail + k;
    const ri = b.length - tail + k;
    lines.push({ kind: "same", leftNo: li + 1, rightNo: ri + 1, text: a[li]! });
  }

  return { ok: true, lines, added, removed };
}
