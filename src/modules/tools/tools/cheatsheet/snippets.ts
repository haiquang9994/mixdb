/**
 * Snippet của cheatsheet: một lệnh có chỗ trống, và cách điền vào chỗ trống đó.
 *
 * Phần điền tham số là **chức năng**, không phải chỗ chứa — đó là thứ phân biệt tool này với một
 * file ghi chú, và là lý do nó qua được tiêu chí nhận tool của module.
 */

export interface Snippet {
  id: string;
  title: string;
  /** Nhóm để xếp danh sách: `mysql`, `postgres`, `docker`, `ssh`… Chuỗi tự do. */
  group: string;
  /** Lệnh, với tham số viết `{{tên}}`. */
  template: string;
}

const PARAM = /\{\{([A-Za-z0-9_]+)\}\}/g;

/** Tên các tham số, theo thứ tự xuất hiện lần đầu, không lặp. */
export function paramsOf(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PARAM)) {
    const name = match[1]!;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Thay `{{tên}}` bằng giá trị.
 *
 * Tên không có giá trị — hoặc có giá trị rỗng — thì **giữ nguyên `{{tên}}`**: một ô chưa điền phải
 * nhìn thấy được trong đầu ra, chứ không biến mất thành khoảng trắng rồi để người dùng chép đi một
 * lệnh thiếu mất một đối số.
 *
 * **Không bọc ngoặc hộ.** Không phải mọi tham số đều đứng ở vị trí một đối số shell, và bọc thêm ở
 * chỗ template đã bọc rồi thì hỏng theo cách khó thấy hơn hẳn cách nó đang hỏng.
 */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(PARAM, (whole, name: string) => {
    const value = values[name];
    return value === undefined || value === "" ? whole : value;
  });
}
