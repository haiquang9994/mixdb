//! The shape of a table rather than its rows: what the Structure tab reads about a table's
//! columns and indexes, and the `ALTER TABLE` statements its editors write back.
//!
//! Everything here goes through `information_schema`, which only ever shows what the connected
//! user has privileges on — so a short list means "this is what you may see", not necessarily
//! "this is all there is".

use super::mysql::quote_ident;
use serde::{Deserialize, Serialize};
use sqlx::mysql::MySqlRow;
use sqlx::{MySqlPool, Row};

/// Reads a text column that `information_schema` may hand over as bytes rather than as characters
/// (`COLUMN_DEFAULT` is a blob-backed column on some servers), and reports an absent value as
/// `None` either way.
fn text(row: &MySqlRow, name: &str) -> Option<String> {
    if let Ok(value) = row.try_get::<Option<String>, _>(name) {
        return value;
    }
    row.try_get::<Option<Vec<u8>>, _>(name)
        .ok()
        .flatten()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn text_or_empty(row: &MySqlRow, name: &str) -> String {
    text(row, name).unwrap_or_default()
}

/// One column as the table currently declares it. Carries the parts a definition is written from
/// plus the read-only facts around them — which key it belongs to, what MySQL computes itself.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureColumn {
    pub name: String,
    /// The full declared type as MySQL spells it: `varchar(255)`, `int unsigned`, `enum('a','b')`.
    pub data_type: String,
    pub nullable: bool,
    /// The column's DEFAULT, or `None` when it has none — which is also how `DEFAULT NULL` reads,
    /// the two being the same thing to a nullable column.
    pub default_value: Option<String>,
    /// Whether the default above is an expression (`uuid()`) rather than a literal. MySQL 8 is
    /// what reports this; on 5.7 only the `CURRENT_TIMESTAMP` family is recognisable, and that
    /// one is recognised from the text itself.
    pub default_is_expression: bool,
    pub auto_increment: bool,
    pub on_update_current_timestamp: bool,
    /// A column MySQL computes from the others. Its expression is not read here, so the editor
    /// offers no way to change one — only to drop it.
    pub generated: bool,
    pub collation: Option<String>,
    pub comment: String,
    /// `PRI`, `UNI`, `MUL` or empty: which kind of key this column is the leading column of.
    pub key: String,
    /// `SHOW COLUMNS`' Extra, verbatim — shown as-is so nothing the fields above don't model
    /// disappears from the grid.
    pub extra: String,
}

/// One collation the connected server actually has, with the character set it belongs to.
///
/// Read from the server rather than listed here, because which collations exist is a property of
/// the version and of how the server was built: `utf8mb4_0900_ai_ci` only exists from MySQL 8.0,
/// `utf8mb3_*` is spelled `utf8_*` before it, and MariaDB has a set of its own.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collation {
    pub name: String,
    pub charset: String,
    /// Whether this is the character set's default — the collation a column of that charset gets
    /// when no `COLLATE` is written.
    pub is_default: bool,
}

/// One column of an index, in the order the index puts them in.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexColumn {
    /// `None` for a functional index, which indexes an expression rather than a column.
    pub name: Option<String>,
    /// How many leading characters are indexed, when only a prefix of the column is.
    pub prefix_length: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableIndex {
    pub name: String,
    pub unique: bool,
    pub primary: bool,
    /// `BTREE`, `HASH`, `FULLTEXT` or `SPATIAL` as MySQL reports it — the last two are a kind of
    /// index rather than a way of storing one, but `information_schema` puts them in this column.
    pub index_type: String,
    pub columns: Vec<IndexColumn>,
    pub comment: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStructure {
    /// In table order, which is the order a `SELECT *` returns them in.
    pub columns: Vec<StructureColumn>,
    /// The primary key first, then the rest as `information_schema` lists them.
    pub indexes: Vec<TableIndex>,
}

/// What a column is to be declared as. The write-side counterpart of {@link StructureColumn}:
/// only the parts that go into a definition, since the rest is not the editor's to set.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSpec {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    /// `None` writes no DEFAULT clause at all.
    #[serde(default)]
    pub default_value: Option<String>,
    /// Emits the default as an expression rather than as a quoted literal. The
    /// `CURRENT_TIMESTAMP` family is recognised without it; this is for the rest (`uuid()`).
    #[serde(default)]
    pub default_is_expression: bool,
    #[serde(default)]
    pub auto_increment: bool,
    #[serde(default)]
    pub on_update_current_timestamp: bool,
    #[serde(default)]
    pub collation: Option<String>,
    #[serde(default)]
    pub comment: String,
    /// Where the column goes: `None` leaves it where it is (or appends a new one), `Some("")`
    /// puts it first, and `Some(name)` puts it directly after that column.
    #[serde(default)]
    pub after: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexColumnSpec {
    pub name: String,
    /// Indexes only the first `n` characters of the column. Required for a `TEXT`/`BLOB` column,
    /// which cannot be indexed whole.
    #[serde(default)]
    pub prefix_length: Option<i64>,
}

/// What an index is to be created as.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSpec {
    /// Left empty, MySQL names the index after its first column. Ignored for a primary key,
    /// which is always called `PRIMARY`.
    #[serde(default)]
    pub name: String,
    /// `index`, `unique`, `fulltext`, `spatial` or `primary`.
    pub kind: String,
    /// `BTREE` or `HASH`, or `None` for the storage engine's own default. Only meaningful for a
    /// plain or unique index — `FULLTEXT` and `SPATIAL` have one structure each.
    #[serde(default)]
    pub index_type: Option<String>,
    pub columns: Vec<IndexColumnSpec>,
    #[serde(default)]
    pub comment: String,
}

/// Wraps text as a SQL string literal, escaping what would otherwise end it early.
fn quote_string(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "''"))
}

/// The functions a DEFAULT may name without being parenthesised — the only expressions a server
/// older than 8.0 can have, and the ones a user types without thinking of them as expressions.
fn is_bare_default_function(upper: &str) -> bool {
    upper.starts_with("CURRENT_TIMESTAMP")
        || upper.starts_with("NOW(")
        || upper == "CURRENT_DATE"
        || upper == "CURRENT_TIME"
        || upper == "CURDATE()"
        || upper == "CURTIME()"
}

/// Whether the column is one of the date/time types, which is what makes a bare
/// `CURRENT_TIMESTAMP` in its default unambiguous: no temporal column can hold those characters as
/// text, whereas a `varchar` perfectly well can.
fn is_temporal_type(data_type: &str) -> bool {
    let lower = data_type.trim().to_lowercase();
    ["timestamp", "datetime", "date", "time", "year"]
        .iter()
        .any(|kind| lower.starts_with(kind))
}

/// How a DEFAULT reaches the DDL. A literal is quoted — MySQL reads a quoted number back as the
/// number, so only the expressions need telling apart, and `NULL` typed on its own is meant as
/// SQL NULL rather than as the four characters.
///
/// A temporal column's `CURRENT_TIMESTAMP` is recognised as the function it can only be; on any
/// other column that text is quoted like anything else, and asking for the function there is what
/// `is_expression` is for.
fn default_clause(value: &str, is_expression: bool, data_type: &str) -> String {
    let trimmed = value.trim();
    let upper = trimmed.to_uppercase();
    if is_bare_default_function(&upper) && (is_expression || is_temporal_type(data_type)) {
        return trimmed.to_string();
    }
    if is_expression {
        // MySQL 8 requires an expression default to be parenthesised, and writes them back out
        // that way itself — so one that already is comes through untouched.
        return if trimmed.starts_with('(') {
            trimmed.to_string()
        } else {
            format!("({trimmed})")
        };
    }
    if upper == "NULL" {
        return "NULL".to_string();
    }
    quote_string(value)
}

/// Turns a spec into the `name type ...` part of an `ADD`/`CHANGE COLUMN` clause.
///
/// The type is interpolated as the user wrote it: MySQL's type grammar is far too large to model,
/// and this client runs user-authored SQL by design. The statement it lands in is a prepared one,
/// which MySQL will not accept more than one statement for, so a `;` in the text cannot become a
/// second statement.
fn column_definition(spec: &ColumnSpec) -> Result<String, String> {
    if spec.name.trim().is_empty() {
        return Err("Column name is required".to_string());
    }
    let data_type = spec.data_type.trim();
    if data_type.is_empty() {
        return Err("Column type is required".to_string());
    }

    let mut sql = format!("{} {}", quote_ident(spec.name.trim()), data_type);
    if let Some(collation) = spec
        .collation
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
    {
        if !collation
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            return Err(format!("Invalid collation `{collation}`"));
        }
        sql.push_str(&format!(" COLLATE {collation}"));
    }
    sql.push_str(if spec.nullable { " NULL" } else { " NOT NULL" });
    if let Some(default) = &spec.default_value {
        sql.push_str(&format!(
            " DEFAULT {}",
            default_clause(default, spec.default_is_expression, data_type)
        ));
    }
    if spec.on_update_current_timestamp {
        sql.push_str(" ON UPDATE CURRENT_TIMESTAMP");
    }
    if spec.auto_increment {
        sql.push_str(" AUTO_INCREMENT");
    }
    let comment = spec.comment.trim();
    if !comment.is_empty() {
        sql.push_str(&format!(" COMMENT {}", quote_string(comment)));
    }
    Ok(sql)
}

/// The trailing `FIRST`/`AFTER x` of a column clause, empty when the column stays where it is.
fn position_clause(after: Option<&str>) -> String {
    match after {
        None => String::new(),
        Some("") => " FIRST".to_string(),
        Some(name) => format!(" AFTER {}", quote_ident(name)),
    }
}

/// The `ADD ...` clause that creates an index, minus the `ALTER TABLE` in front of it.
fn add_index_clause(spec: &IndexSpec) -> Result<String, String> {
    if spec.columns.is_empty() {
        return Err("An index needs at least one column".to_string());
    }

    let columns = spec
        .columns
        .iter()
        .map(|column| {
            if column.name.trim().is_empty() {
                return Err("An index column must be named".to_string());
            }
            let quoted = quote_ident(column.name.trim());
            Ok(match column.prefix_length {
                Some(length) if length > 0 => format!("{quoted}({length})"),
                _ => quoted,
            })
        })
        .collect::<Result<Vec<_>, String>>()?
        .join(", ");

    let kind = spec.kind.to_lowercase();
    if kind == "primary" {
        // A primary key carries no name of its own, and MySQL accepts neither a comment nor a
        // USING clause on the `ADD PRIMARY KEY` form.
        return Ok(format!("ADD PRIMARY KEY ({columns})"));
    }

    let keyword = match kind.as_str() {
        "index" => "INDEX",
        "unique" => "UNIQUE INDEX",
        "fulltext" => "FULLTEXT INDEX",
        "spatial" => "SPATIAL INDEX",
        other => return Err(format!("Unknown index kind `{other}`")),
    };
    let name = spec.name.trim();
    let named = if name.is_empty() {
        // Left unnamed, MySQL names the index after its first column — which is what a client
        // that made one up would have had to guess at anyway.
        String::new()
    } else {
        format!(" {}", quote_ident(name))
    };

    let mut clause = format!("ADD {keyword}{named} ({columns})");
    // Only the two general-purpose kinds have a choice of structure; FULLTEXT and SPATIAL each
    // have exactly one, and MySQL rejects a USING clause on them.
    if kind == "index" || kind == "unique" {
        if let Some(index_type) = spec
            .index_type
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
        {
            let upper = index_type.to_uppercase();
            if upper != "BTREE" && upper != "HASH" {
                return Err(format!("Unknown index type `{index_type}`"));
            }
            clause.push_str(&format!(" USING {upper}"));
        }
    }
    let comment = spec.comment.trim();
    if !comment.is_empty() {
        clause.push_str(&format!(" COMMENT {}", quote_string(comment)));
    }
    Ok(clause)
}

/// The `DROP ...` clause that removes an index by name.
fn drop_index_clause(name: &str) -> String {
    if name == "PRIMARY" {
        // The primary key has no name to drop it by, only its own keyword.
        "DROP PRIMARY KEY".to_string()
    } else {
        format!("DROP INDEX {}", quote_ident(name))
    }
}

fn qualified(database: &str, table: &str) -> String {
    format!("{}.{}", quote_ident(database), quote_ident(table))
}

/// Runs one statement built here. Prepared rather than sent as text, so that MySQL itself refuses
/// anything that turns out to be more than a single statement.
async fn execute(pool: &MySqlPool, sql: String) -> Result<(), String> {
    sqlx::query(sqlx::AssertSqlSafe(sql))
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub async fn table_structure(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<TableStructure, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let column_rows = sqlx::query(
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT,
                COLUMN_KEY, COLLATION_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION",
    )
    .bind(database)
    .bind(table)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if column_rows.is_empty() {
        return Err(format!(
            "No columns of `{database}`.`{table}` are visible — the table may not exist, or the \
             connected user may have no privileges on it"
        ));
    }

    let columns = column_rows
        .iter()
        .map(|row| {
            let extra = text_or_empty(row, "EXTRA");
            let extra_lower = extra.to_lowercase();
            StructureColumn {
                name: text_or_empty(row, "COLUMN_NAME"),
                data_type: text_or_empty(row, "COLUMN_TYPE"),
                nullable: text_or_empty(row, "IS_NULLABLE").eq_ignore_ascii_case("YES"),
                default_value: text(row, "COLUMN_DEFAULT"),
                // `DEFAULT_GENERATED` is MySQL 8's marker for an expression default. The
                // `CURRENT_TIMESTAMP` family carries it too, but is recognised from its own text
                // wherever it appears, so it needs nothing from here.
                default_is_expression: extra_lower.contains("default_generated"),
                auto_increment: extra_lower.contains("auto_increment"),
                on_update_current_timestamp: extra_lower.contains("on update current_timestamp"),
                // Matched on the two full phrases rather than on "generated" alone, which
                // `DEFAULT_GENERATED` also contains.
                generated: extra_lower.contains("virtual generated")
                    || extra_lower.contains("stored generated"),
                collation: text(row, "COLLATION_NAME"),
                comment: text_or_empty(row, "COLUMN_COMMENT"),
                key: text_or_empty(row, "COLUMN_KEY"),
                extra,
            }
        })
        .collect();

    // `NON_UNIQUE` and `SUB_PART` are typed differently across MySQL versions (signed vs
    // unsigned, int vs bigint), so both are cast to one decodable type by the server.
    let index_rows = sqlx::query(
        "SELECT INDEX_NAME, CAST(NON_UNIQUE AS SIGNED) AS non_unique, COLUMN_NAME,
                CAST(SUB_PART AS SIGNED) AS sub_part, INDEX_TYPE, INDEX_COMMENT
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY INDEX_NAME, SEQ_IN_INDEX",
    )
    .bind(database)
    .bind(table)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut indexes: Vec<TableIndex> = Vec::new();
    for row in &index_rows {
        let name = text_or_empty(row, "INDEX_NAME");
        let column = IndexColumn {
            // NULL for a functional index, which indexes an expression instead of a column.
            name: text(row, "COLUMN_NAME"),
            prefix_length: row.try_get::<Option<i64>, _>("sub_part").unwrap_or(None),
        };
        // The rows come ordered by index and then by position within it, so each index's columns
        // arrive together and the one being built is always the last.
        match indexes.last_mut() {
            Some(last) if last.name == name => last.columns.push(column),
            _ => indexes.push(TableIndex {
                primary: name == "PRIMARY",
                unique: row.try_get::<i64, _>("non_unique").unwrap_or(1) == 0,
                index_type: text_or_empty(row, "INDEX_TYPE"),
                comment: text_or_empty(row, "INDEX_COMMENT"),
                name,
                columns: vec![column],
            }),
        }
    }
    // The primary key first — it is the one index the table is organised by. `sort_by_key` is
    // stable, so everything else keeps the order it was listed in.
    indexes.sort_by_key(|index| !index.primary);

    Ok(TableStructure { columns, indexes })
}

/// Every collation the server supports, in character set order. Read once and offered as a list to
/// choose from, so a column's `COLLATE` can only ever name something this server knows.
pub async fn collations(pool: &MySqlPool) -> Result<Vec<Collation>, String> {
    let rows = sqlx::query(
        "SELECT COLLATION_NAME, CHARACTER_SET_NAME, IS_DEFAULT
         FROM information_schema.COLLATIONS
         ORDER BY CHARACTER_SET_NAME, COLLATION_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|row| Collation {
            name: text_or_empty(row, "COLLATION_NAME"),
            charset: text_or_empty(row, "CHARACTER_SET_NAME"),
            // `Yes` on the character set's default, empty on the rest.
            is_default: text_or_empty(row, "IS_DEFAULT").eq_ignore_ascii_case("Yes"),
        })
        .filter(|collation| !collation.name.is_empty())
        .collect())
}

pub async fn add_column(
    pool: &MySqlPool,
    database: &str,
    table: &str,
    spec: &ColumnSpec,
) -> Result<(), String> {
    let definition = column_definition(spec)?;
    let position = position_clause(spec.after.as_deref());
    execute(
        pool,
        format!(
            "ALTER TABLE {} ADD COLUMN {definition}{position}",
            qualified(database, table)
        ),
    )
    .await
}

/// Redefines an existing column, `name` being what it is called now — `CHANGE COLUMN` is what
/// lets a rename and a redefinition happen in the one statement, so the editor can offer both in
/// the one form.
pub async fn modify_column(
    pool: &MySqlPool,
    database: &str,
    table: &str,
    name: &str,
    spec: &ColumnSpec,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("The column being changed must be named".to_string());
    }
    let definition = column_definition(spec)?;
    let position = position_clause(spec.after.as_deref());
    execute(
        pool,
        format!(
            "ALTER TABLE {} CHANGE COLUMN {} {definition}{position}",
            qualified(database, table),
            quote_ident(name)
        ),
    )
    .await
}

pub async fn drop_column(
    pool: &MySqlPool,
    database: &str,
    table: &str,
    name: &str,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("The column being dropped must be named".to_string());
    }
    execute(
        pool,
        format!(
            "ALTER TABLE {} DROP COLUMN {}",
            qualified(database, table),
            quote_ident(name)
        ),
    )
    .await
}

pub async fn add_index(
    pool: &MySqlPool,
    database: &str,
    table: &str,
    spec: &IndexSpec,
) -> Result<(), String> {
    let clause = add_index_clause(spec)?;
    execute(
        pool,
        format!("ALTER TABLE {} {clause}", qualified(database, table)),
    )
    .await
}

/// Replaces an index. MySQL cannot alter one in place, so the old index is dropped and the new one
/// created — both in a single `ALTER TABLE`, which is what keeps the table from spending any time
/// without the index at all.
pub async fn modify_index(
    pool: &MySqlPool,
    database: &str,
    table: &str,
    name: &str,
    spec: &IndexSpec,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("The index being changed must be named".to_string());
    }
    let clause = add_index_clause(spec)?;
    execute(
        pool,
        format!(
            "ALTER TABLE {} {}, {clause}",
            qualified(database, table),
            drop_index_clause(name)
        ),
    )
    .await
}

pub async fn drop_index(
    pool: &MySqlPool,
    database: &str,
    table: &str,
    name: &str,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("The index being dropped must be named".to_string());
    }
    execute(
        pool,
        format!(
            "ALTER TABLE {} {}",
            qualified(database, table),
            drop_index_clause(name)
        ),
    )
    .await
}
