//! The part of the grid's filter bar that reads the same whichever database is underneath: how
//! the one text box a row gives an `IN`/`BETWEEN` operator is split into its items. Turning those
//! items into a query is per-database — `build_where` in `mysql.rs`, `build_filter` in `mongo.rs`.

/// One item of a split value, and whether it arrived in quotes. The quotes are what a caller that
/// infers types from the text goes by: `123` is a number, `'123'` is that number spelled out.
pub struct ListItem {
    pub text: String,
    pub quoted: bool,
}

/// Splits an `IN`/`BETWEEN` value into its items: comma-separated, with each item trimmed.
///
/// An item may be wrapped in single or double quotes, which is how a value that itself contains a
/// comma (or leading/trailing spaces that matter) gets through: the quotes are stripped and the
/// text inside them is taken as-is. Empty items are dropped, so `1,2,` is two items — but a
/// quoted `''` is kept, as that is the only way to ask for an empty string in a list.
///
/// The frontend mirrors this in `src/filters.ts` to decide whether a row has enough to be worth
/// sending; the two must agree on how many items a value holds.
pub fn split_list_parts(raw: &str) -> Vec<ListItem> {
    let mut items: Vec<ListItem> = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut quoted = false;

    let mut flush = |current: &mut String, quoted: &mut bool| {
        let text = if *quoted {
            std::mem::take(current)
        } else {
            current.trim().to_string()
        };
        if *quoted || !text.is_empty() {
            items.push(ListItem {
                text,
                quoted: *quoted,
            });
        }
        current.clear();
        *quoted = false;
    };

    for ch in raw.chars() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => current.push(ch),
            None if ch == '\'' || ch == '"' => {
                quote = Some(ch);
                quoted = true;
            }
            None if ch == ',' => flush(&mut current, &mut quoted),
            None => current.push(ch),
        }
    }
    flush(&mut current, &mut quoted);
    items
}

/// {@link split_list_parts} for a caller that binds every item as text anyway and so has no use
/// for knowing which of them were quoted.
pub fn split_list(raw: &str) -> Vec<String> {
    split_list_parts(raw)
        .into_iter()
        .map(|item| item.text)
        .collect()
}

/// Takes the quotes off a value that is wrapped in a matching pair of them, which is how a single
/// value is spelled when it is to be read as text and nothing else. Anything not so wrapped comes
/// back as `None` and is left to whatever the caller infers from it.
pub fn unquote(raw: &str) -> Option<&str> {
    let mut chars = raw.chars();
    let first = chars.next()?;
    if first != '\'' && first != '"' {
        return None;
    }
    let last = chars.next_back()?;
    if last != first {
        return None;
    }
    Some(&raw[first.len_utf8()..raw.len() - last.len_utf8()])
}
