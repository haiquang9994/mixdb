//! SQLite: opening a database file, and reading what is in it.
//!
//! The one driver here with no server behind it. That is the whole of what makes it different, and
//! it shows up in three places: there is no endpoint to dial and so no SSH tunnel and no TLS; there
//! is one database per connection and it is always SQLite's own `main`; and the thing being opened
//! is a file on this machine that some other program may be writing to at the same time.
//!
//! Metadata is read through the `pragma_*` table-valued functions rather than through `PRAGMA`
//! statements. A `PRAGMA` takes no bind parameters, so reading a table's columns that way would
//! mean pasting a table name into SQL text; the functions take it as a parameter like any other
//! query.

use super::filters::{escape_like, split_list};
use crate::error::AppError;
use crate::modules::db::models::ServerInfo;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow};
use sqlx::{Column, Row, SqlitePool, TypeInfo, ValueRef};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

/// What the one database of a SQLite connection is called, everywhere above this module: in the
/// sidebar, in the commands that take a database name, and in the frontend's state.
///
/// SQLite's own name for it. A file holds exactly one, and `ATTACH` — which is how a second one
/// would appear — is not offered.
pub const MAIN_DATABASE: &str = "main";

/// How long a statement waits for another writer before giving up. The default sqlx picks, named
/// here because it is a decision: the file may be open in another program, and five seconds is long
/// enough to ride out a short write and short enough that a held lock is reported rather than hung
/// on.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// The counterpart of `mysql::map_error` — see `mysql::lost_connection` for what it is for.
///
/// There is no connection to lose here, so nothing maps to `error.connectionLost`: a file that has
/// gone away fails at the next statement with SQLite's own words, and those are worth showing.
pub(super) fn map_error(e: sqlx::Error) -> AppError {
    err!("error.sqlite", message = e)
}

/// Opens the database file at `path`.
///
/// **Never creates one.** `create_if_missing` is sqlx's default and is set here anyway, because
/// leaving it implicit makes a typed-in path that does not exist look like a working connection to
/// an empty database — see D5 of the plan this was built from. A missing file is an error.
///
/// The journal mode is deliberately not set. sqlx only issues `PRAGMA journal_mode` when it is
/// asked to, so opening someone's database here leaves whatever mode it is in alone; setting it
/// would rewrite the file — and convert a rollback-journal database to WAL — just by looking at it.
///
/// Foreign keys are enforced, which is sqlx's default rather than SQLite's own. Kept, because the
/// Structure tab shows a table's foreign keys and a delete that ignored them would be the app
/// disagreeing with what it just displayed.
pub async fn connect(path: &str) -> Result<SqlitePool, AppError> {
    let path = path.trim();
    if path.is_empty() {
        return Err(err!("error.sqlitePathRequired"));
    }
    /* Checked before opening rather than left to SQLite, which reports a missing file as
       "unable to open database file" — the same words it uses for a directory, a permission
       problem and a corrupt header. */
    if !Path::new(path).is_file() {
        return Err(err!("error.sqliteFileNotFound", path = path));
    }

    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .busy_timeout(BUSY_TIMEOUT);

    SqlitePoolOptions::new()
        .connect_with(options)
        .await
        .map_err(map_error)
}

/// The version of the SQLite the app carries, and the file it is pointed at.
///
/// `os` is the file's name rather than a machine's: the header line reads "SQLite 3.x on blog.db",
/// which is the useful thing to say when what you are connected to is a path. The engine is the one
/// compiled into MixDB — a SQLite database file has no server to ask.
pub async fn server_info(pool: &SqlitePool) -> Result<ServerInfo, AppError> {
    let version: String = sqlx::query("select sqlite_version()")
        .fetch_one(pool)
        .await
        .map_err(map_error)?
        .try_get(0)
        .map_err(map_error)?;

    let filename = pool.connect_options().get_filename().to_path_buf();
    let os = filename
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| filename.to_string_lossy().into_owned());

    Ok(ServerInfo { version, os })
}

/// The one database there is.
///
/// A function rather than a constant at the call site, so the sidebar's list is read the same way
/// it is for every other engine — and so that attaching a second database one day changes this and
/// nothing above it.
pub fn list_databases() -> Vec<String> {
    vec![MAIN_DATABASE.to_string()]
}

/// Every table and view, by name.
///
/// Views are included, as they are in MySQL's `SHOW TABLES` — the sidebar opens one and reads it
/// like a table. `sqlite_%` is SQLite's own reserved prefix: those hold the schema and the sequence
/// counters, and are no more a user's tables than `information_schema` is.
pub async fn list_tables(pool: &SqlitePool) -> Result<Vec<String>, AppError> {
    sqlx::query_scalar(
        r"select name from sqlite_master
          where type in ('table', 'view') and name not like 'sqlite\_%' escape '\'
          order by name",
    )
    .fetch_all(pool)
    .await
    .map_err(map_error)
}

/// Double-quotes an identifier for interpolation into SQL text, doubling embedded quotes — the
/// counterpart of `postgres::quote_ident`, and the same rule.
///
/// SQLite also accepts backticks and square brackets, but writes and understands the standard form,
/// so that is the one used.
pub(super) fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

/// One condition from the filter bar. The same three fields the other drivers take, declared here
/// rather than shared, the way `mysql::Filter` and the Mongo one are.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub column: String,
    pub operator: String,
    #[serde(default)]
    pub value: Option<String>,
}

/// Which page of a table is wanted, and what it is cut out of.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageQuery {
    pub page: i64,
    pub page_size: i64,
    /// Ignored unless it names a real column of this table.
    #[serde(default)]
    pub sort_column: Option<String>,
    #[serde(default)]
    pub sort_desc: bool,
    /// ANDed together; `total` counts what is left after them.
    #[serde(default)]
    pub filters: Vec<Filter>,
}

/// The row a foreign key column points at.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKey {
    pub table: String,
    pub column: String,
}

/// What is known about one column beyond its name — everything a new row has to respect.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    /// The declared type, as the table's own DDL spells it: `TEXT`, `varchar(255)`, or the empty
    /// string — SQLite lets a column be declared with no type at all, and stores whatever it is
    /// given regardless of what is written here.
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    /// Space-separated tokens, read by `src/modules/db/sqlite/columns.ts`: `rowid` for the
    /// `INTEGER PRIMARY KEY` that aliases the row id, and `generated` for a computed column.
    pub extra: String,
    pub foreign_key: Option<ForeignKey>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TablePage {
    pub columns: Vec<String>,
    /// Keyed by column name; `columns` is what carries their order.
    pub column_meta: BTreeMap<String, ColumnMeta>,
    pub primary_key: Vec<String>,
    /// The `INTEGER PRIMARY KEY`, when the table has one — the only column SQLite fills in by
    /// itself, and so the only counter there is anything to reset.
    pub auto_increment_column: Option<String>,
    pub rows: Vec<Map<String, Value>>,
    pub total: i64,
}

/// One column of a table, as `pragma_table_xinfo` reports it.
///
/// `xinfo` rather than `info`, because `info` leaves generated columns out entirely — and a column
/// the grid cannot see is a column an `INSERT` built from the grid would not know to skip.
struct ColumnRow {
    name: String,
    declared_type: String,
    notnull: bool,
    default_value: Option<String>,
    /// Position in the primary key, 1-based; 0 for a column that is not part of it.
    pk: i64,
    /// 0 for an ordinary column, 2 or 3 for a generated one (virtual and stored), 1 for a hidden
    /// column of a virtual table.
    hidden: i64,
}

/// Reads what a table is made of, in table order.
async fn table_columns(pool: &SqlitePool, table: &str) -> Result<Vec<ColumnRow>, AppError> {
    let rows = sqlx::query(
        "select name, type, \"notnull\", dflt_value, pk, hidden from pragma_table_xinfo(?)",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(map_error)?;

    Ok(rows
        .iter()
        .map(|r| ColumnRow {
            name: r.get::<String, _>("name"),
            declared_type: r.get::<String, _>("type"),
            notnull: r.get::<i64, _>("notnull") != 0,
            default_value: r.get::<Option<String>, _>("dflt_value"),
            pk: r.get::<i64, _>("pk"),
            hidden: r.get::<i64, _>("hidden"),
        })
        // A virtual table's hidden columns are not part of its rows and cannot be written to.
        .filter(|c| c.hidden != 1)
        .collect())
}

/// Which columns of the table are foreign keys, and what each one points at.
///
/// A failure is the caller's to swallow: the markers are decoration on the grid, and losing them
/// must not cost the rows.
async fn foreign_keys(
    pool: &SqlitePool,
    table: &str,
) -> Result<BTreeMap<String, ForeignKey>, AppError> {
    let rows = sqlx::query("select \"table\", \"from\", \"to\" from pragma_foreign_key_list(?)")
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(map_error)?;

    Ok(rows
        .iter()
        .map(|r| {
            let from = r.get::<String, _>("from");
            let target = r.get::<String, _>("table");
            /* `to` is null when the key points at the other table's primary key without naming it.
               Resolving that would be a second read per key; the grid only needs a column to show,
               and the primary key is what it would resolve to. */
            let column = r
                .get::<Option<String>, _>("to")
                .unwrap_or_else(|| "rowid".to_string());
            (from, ForeignKey { table: target, column })
        })
        .collect())
}

/// The tokens `src/modules/db/sqlite/columns.ts` reads. The two files are the only ones that need
/// to agree on them.
fn extra_tokens(column: &ColumnRow, single_column_key: bool) -> String {
    let mut tokens: Vec<&str> = Vec::new();
    /* The one column SQLite assigns for you, and only in this exact shape: a single-column primary
       key declared `INTEGER`. `INT`, `BIGINT` or a two-column key are ordinary columns that happen
       to be keys, and an INSERT must still name them. */
    if single_column_key && column.pk == 1 && column.declared_type.eq_ignore_ascii_case("integer") {
        tokens.push("rowid");
    }
    if column.hidden == 2 || column.hidden == 3 {
        tokens.push("generated");
    }
    tokens.join(" ")
}

/// Reads one page of a table. `query.sort_column` orders the whole table before the page is cut out
/// of it, and is ignored unless it names a real column — which is also what keeps it out of the SQL
/// text unchecked. `query.filters` narrows the table down first, and `total` counts what is left
/// after them.
pub async fn table_data(
    pool: &SqlitePool,
    table: &str,
    query: &PageQuery,
) -> Result<TablePage, AppError> {
    let column_rows = table_columns(pool, table).await?;
    if column_rows.is_empty() {
        return Err(err!("error.unknownTable", table = table));
    }
    let quoted = quote_ident(table);
    let columns: Vec<String> = column_rows.iter().map(|c| c.name.clone()).collect();
    let mut foreign_keys = foreign_keys(pool, table).await.unwrap_or_default();

    let mut key_columns: Vec<(i64, String)> = column_rows
        .iter()
        .filter(|c| c.pk > 0)
        .map(|c| (c.pk, c.name.clone()))
        .collect();
    key_columns.sort_by_key(|(position, _)| *position);
    let single_column_key = key_columns.len() == 1;
    let primary_key: Vec<String> = key_columns.into_iter().map(|(_, name)| name).collect();

    let auto_increment_column = column_rows
        .iter()
        .find(|c| extra_tokens(c, single_column_key).contains("rowid"))
        .map(|c| c.name.clone());

    let column_meta: BTreeMap<String, ColumnMeta> = column_rows
        .iter()
        .map(|c| {
            (
                c.name.clone(),
                ColumnMeta {
                    data_type: c.declared_type.clone(),
                    nullable: !c.notnull,
                    default_value: c.default_value.clone(),
                    extra: extra_tokens(c, single_column_key),
                    foreign_key: foreign_keys.remove(&c.name),
                },
            )
        })
        .collect();

    let (where_clause, binds) = build_where(&query.filters, &columns)?;

    let count_sql = format!("SELECT COUNT(*) FROM {quoted}{where_clause}");
    let mut count_query = sqlx::query_scalar(sqlx::AssertSqlSafe(count_sql));
    for value in &binds {
        count_query = count_query.bind(value.as_str());
    }
    let total: i64 = count_query.fetch_one(pool).await.map_err(map_error)?;

    // The ceiling is the largest page size the grid offers; see `mysql::table_data`.
    let page_size = query.page_size.clamp(1, 5000);
    let offset = query.page.max(0).saturating_mul(page_size);
    let order_by = query
        .sort_column
        .as_deref()
        .filter(|c| columns.iter().any(|existing| existing == c))
        .map(|c| {
            format!(
                " ORDER BY {} {}",
                quote_ident(c),
                if query.sort_desc { "DESC" } else { "ASC" }
            )
        })
        .unwrap_or_default();
    /* Named one by one rather than `SELECT *`: a generated column is in `columns` and the rows have
       to line up with it, and `SELECT *` on a table with one leaves it out. */
    let select_list = columns
        .iter()
        .map(|name| quote_ident(name))
        .collect::<Vec<_>>()
        .join(", ");
    let data_sql = format!(
        "SELECT {select_list} FROM {quoted}{where_clause}{order_by} LIMIT {page_size} OFFSET {offset}"
    );
    let mut data_query = sqlx::query(sqlx::AssertSqlSafe(data_sql));
    for value in &binds {
        data_query = data_query.bind(value.as_str());
    }
    let rows = data_query.fetch_all(pool).await.map_err(map_error)?;

    Ok(TablePage {
        columns,
        column_meta,
        primary_key,
        auto_increment_column,
        rows: rows.iter().map(row_to_json).collect(),
        total,
    })
}

/// One row, as the object the grid shows.
pub(super) fn row_to_json(row: &SqliteRow) -> Map<String, Value> {
    let mut obj = Map::new();
    for (i, col) in row.columns().iter().enumerate() {
        obj.insert(col.name().to_string(), column_value(row, i));
    }
    obj
}

/// One value, as the closest JSON the frontend can show.
///
/// Read off the value's storage class rather than off the column's declared type, because in SQLite
/// those are different questions: a column declared `INTEGER` holds whatever was written to it, and
/// a `try_get` ladder like the other drivers' would report what the bytes could be read as rather
/// than what they are.
pub(super) fn column_value(row: &SqliteRow, i: usize) -> Value {
    let Ok(raw) = row.try_get_raw(i) else {
        return Value::Null;
    };
    if raw.is_null() {
        return Value::Null;
    }
    match raw.type_info().name() {
        "INTEGER" => row.try_get::<i64, _>(i).map(Value::from).unwrap_or(Value::Null),
        "REAL" => row
            .try_get::<f64, _>(i)
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        // Bytes have no representation of their own in JSON; the grid knows to read a column whose
        // declared type says BLOB as base64. See `isBinary` in `sqlite/columns.ts`.
        "BLOB" => {
            use base64::Engine;
            row.try_get::<Vec<u8>, _>(i)
                .map(|bytes| Value::String(base64::engine::general_purpose::STANDARD.encode(bytes)))
                .unwrap_or(Value::Null)
        }
        _ => row
            .try_get::<String, _>(i)
            .map(Value::String)
            .unwrap_or(Value::Null),
    }
}

/// Turns the filter rows into a WHERE clause (leading space included, empty when nothing filters)
/// and the values to bind into its placeholders, in order.
///
/// Every value reaches SQLite as a bound parameter; the column name is the one part interpolated,
/// which is why it is checked against the table's own columns first.
///
/// There is no `regexp` arm, and that is not an omission: SQLite parses the word but ships no
/// implementation, so such a clause would always fail with "no such function: regexp". The dropdown
/// does not offer the operator either — see `regexpFilter` on the dialect.
fn build_where(filters: &[Filter], columns: &[String]) -> Result<(String, Vec<String>), AppError> {
    let mut clauses: Vec<String> = Vec::new();
    let mut binds: Vec<String> = Vec::new();
    let bind = |binds: &mut Vec<String>, value: String| {
        binds.push(value);
        "?".to_string()
    };

    for filter in filters {
        if !columns.iter().any(|c| c == &filter.column) {
            return Err(err!("error.unknownFilterColumn", column = &filter.column));
        }
        let col = quote_ident(&filter.column);
        /* Compared as text, so that what is typed into the filter box matches what the grid shows
           whatever storage class the cell holds — SQLite otherwise sorts every string after every
           number, and `= '5'` would not find an integer 5. The ordering operators are the
           exception: there the column stands, so numbers compare as numbers. */
        let text = format!("CAST({col} AS TEXT)");
        let value = filter.value.as_deref().unwrap_or("");
        let operator = filter.operator.as_str();

        let clause = match operator {
            "eq" => format!("{text} = {}", bind(&mut binds, value.to_string())),
            "ne" => format!("{text} <> {}", bind(&mut binds, value.to_string())),
            "gt" => format!("{col} > {}", bind(&mut binds, value.to_string())),
            "gte" => format!("{col} >= {}", bind(&mut binds, value.to_string())),
            "lt" => format!("{col} < {}", bind(&mut binds, value.to_string())),
            "lte" => format!("{col} <= {}", bind(&mut binds, value.to_string())),
            "contains" => format!(
                "{text} LIKE {} ESCAPE '\\'",
                bind(&mut binds, format!("%{}%", escape_like(value)))
            ),
            "notContains" => format!(
                "{text} NOT LIKE {} ESCAPE '\\'",
                bind(&mut binds, format!("%{}%", escape_like(value)))
            ),
            "startsWith" => format!(
                "{text} LIKE {} ESCAPE '\\'",
                bind(&mut binds, format!("{}%", escape_like(value)))
            ),
            "endsWith" => format!(
                "{text} LIKE {} ESCAPE '\\'",
                bind(&mut binds, format!("%{}", escape_like(value)))
            ),
            "like" => format!("{text} LIKE {}", bind(&mut binds, value.to_string())),
            "notLike" => format!("{text} NOT LIKE {}", bind(&mut binds, value.to_string())),
            "in" | "notIn" => {
                let items = split_list(value);
                if items.is_empty() {
                    continue;
                }
                let placeholders = items
                    .into_iter()
                    .map(|item| bind(&mut binds, item))
                    .collect::<Vec<_>>()
                    .join(", ");
                let sql_op = if operator == "in" { "IN" } else { "NOT IN" };
                format!("{text} {sql_op} ({placeholders})")
            }
            "between" | "notBetween" => {
                let items = split_list(value);
                // Two bounds or nothing — one of them alone says nothing about a range.
                if items.len() < 2 {
                    continue;
                }
                let low = bind(&mut binds, items[0].clone());
                let high = bind(&mut binds, items[1].clone());
                let sql_op = if operator == "between" {
                    "BETWEEN"
                } else {
                    "NOT BETWEEN"
                };
                format!("{col} {sql_op} {low} AND {high}")
            }
            "isNull" => format!("{col} IS NULL"),
            "isNotNull" => format!("{col} IS NOT NULL"),
            "isEmpty" => format!("{text} = ''"),
            "isNotEmpty" => format!("{text} <> ''"),
            other => return Err(err!("error.unknownFilterOperator", operator = other)),
        };

        clauses.push(clause);
    }

    if clauses.is_empty() {
        return Ok((String::new(), binds));
    }
    Ok((format!(" WHERE {}", clauses.join(" AND ")), binds))
}
