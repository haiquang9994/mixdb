//! Tạo và sửa schema trên ClickHouse: database, bảng, cột.
//!
//! Tách khỏi `clickhouse.rs` theo đúng cách `postgres_ddl.rs` tách khỏi `postgres.rs` — file kia
//! đã lo việc đọc, và DDL là một mảng đủ lớn để đứng riêng.
//!
//! Mọi câu lệnh được dựng bởi một hàm thuần rồi mới gửi đi, nên phần quyết định *viết gì* có test
//! không cần server, còn phần gửi chỉ còn là `execute_check`. Không có transaction ở đây: ClickHouse
//! không có, nên một chuỗi nhiều câu lệnh hỏng giữa chừng để lại đúng những gì đã chạy.

/// Phần thân của một chuỗi literal ClickHouse, hoặc `None` nếu văn bản không phải một literal trọn
/// vẹn.
///
/// "Trọn vẹn" là điều kiện quan trọng: `'a' || 'b'` cũng mở và đóng bằng nháy đơn nhưng là một biểu
/// thức, nên nháy đóng phải là ký tự cuối cùng thì mới tính. Escape theo backslash, cùng quy ước
/// `clickhouse::quote_literal` dùng để đi ra.
pub(super) fn literal_body(text: &str) -> Option<String> {
    let mut chars = text.char_indices();
    if chars.next()?.1 != '\'' {
        return None;
    }
    let mut body = String::new();
    while let Some((index, ch)) = chars.next() {
        match ch {
            '\\' => body.push(chars.next()?.1),
            '\'' => {
                return if index + 1 == text.len() { Some(body) } else { None };
            }
            _ => body.push(ch),
        }
    }
    None
}

/// `system.columns.default_expression` tách thành giá trị đem hiện và việc nó là biểu thức hay
/// không — `'active'` là literal `active`, `now()` là biểu thức, `42` cũng là biểu thức (viết ra
/// lại nguyên văn thì vẫn đúng, và ClickHouse không có gì để phân biệt nó với một hàm không đối).
///
/// Nghịch đảo của nó là `default_clause`, viết cùng một giá trị trở ra SQL.
pub(super) fn read_default(expression: &str) -> Option<(String, bool)> {
    let text = expression.trim();
    if text.is_empty() {
        return None;
    }
    match literal_body(text) {
        Some(body) => Some((body, false)),
        None => Some((text.to_string(), true)),
    }
}

/// Những gì quyết định ở đây, chứ không phải bởi câu trả lời của server.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quoted_string_is_a_literal_and_loses_its_quotes() {
        assert_eq!(read_default("'active'"), Some(("active".to_string(), false)));
    }

    #[test]
    fn a_function_call_is_an_expression_kept_verbatim() {
        assert_eq!(read_default("now()"), Some(("now()".to_string(), true)));
    }

    #[test]
    fn a_number_is_an_expression_there_being_nothing_to_tell_it_from_one() {
        assert_eq!(read_default("42"), Some(("42".to_string(), true)));
    }

    #[test]
    fn nothing_at_all_is_no_default() {
        assert_eq!(read_default(""), None);
        assert_eq!(read_default("   "), None);
    }

    #[test]
    fn a_concatenation_that_merely_starts_and_ends_with_a_quote_is_not_a_literal() {
        assert_eq!(read_default("'a' || 'b'"), Some(("'a' || 'b'".to_string(), true)));
    }

    #[test]
    fn an_escaped_quote_inside_a_literal_is_unescaped() {
        assert_eq!(read_default("'it\\'s'"), Some(("it's".to_string(), false)));
    }
}
