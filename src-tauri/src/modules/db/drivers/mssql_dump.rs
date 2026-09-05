//! Dumping a SQL Server database to a `.sql` file and replaying one back in — no external tool
//! (D10): Microsoft ships nothing free and pinnable equivalent to `pg_dump`/`mysqldump`, so this
//! regenerates `CREATE TABLE`/`CREATE INDEX` from the same catalogue reads Plan 2's Structure tab
//! already makes (`mssql_structure::table_structure`) and reuses Plan 6's statement builders
//! (`mssql_ddl::column_definition`/`create_index_statements`) rather than inventing a second way to
//! spell either. Closest in shape to `sqlite_dump.rs`, not `clickhouse_dump.rs`: both this file and
//! SQLite's read rows one Rust value at a time through a normal driver, where ClickHouse's
//! `FORMAT SQLInsert` has the server generate the `INSERT` text itself — so this file, like
//! `sqlite_dump.rs`, writes its own value-to-literal conversion (see `sql_literal` in
//! `dump_data.rs`'s sibling work, added in a later task of this plan).

use super::dump::{self, Tracker};
use super::mssql::{map_error, quote_ident, read_uncommitted, resolve, three_part, Pool};
use super::mssql_ddl::{
    column_definition, comment_statement, create_index_statements, index_spec_from, ColumnSpec,
};
use super::mssql_structure::{self, StructureColumn};
use crate::error::AppError;
use std::collections::HashMap;

/// Turns a read-back [`StructureColumn`] into the [`ColumnSpec`] shape `column_definition` (Plan 6)
/// was written for — the two structs carry the same fields under the same names by construction
/// (`mssql_ddl::ColumnSpec` is `structure_columns`' write-side counterpart), so this is a plain
/// field-for-field copy, not a translation.
///
/// Never called for a `generated` column — see [`computed_column_definition`], which a computed
/// column's entry in `TableStructure::columns` is routed to instead. `default_value`/
/// `default_is_expression` on a computed column do not carry its expression (Vượt quá chữ spec #4
/// of this plan) and would produce a plain column with a wrong or missing default if this ran on
/// one.
fn column_spec_from(column: &StructureColumn) -> ColumnSpec {
    ColumnSpec {
        name: column.name.clone(),
        data_type: column.data_type.clone(),
        nullable: column.nullable,
        default_value: column.default_value.clone(),
        default_is_expression: column.default_is_expression,
        auto_increment: column.auto_increment,
        collation: column.collation.clone(),
        comment: column.comment.clone(),
    }
}

/// One computed column's expression, read separately from `mssql_structure::structure_columns`
/// because that read's `default_value` comes from `sys.default_constraints` — which a computed
/// column has no row in at all. The expression lives in `sys.computed_columns.definition` instead.
struct ComputedDefinition {
    definition: String,
    persisted: bool,
}

async fn computed_definitions(
    pool: &Pool,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<HashMap<String, ComputedDefinition>, AppError> {
    let db = quote_ident(database);
    let sql = read_uncommitted(&format!(
        "SELECT c.name, cc.definition, cc.is_persisted
         FROM {db}.sys.computed_columns cc
         JOIN {db}.sys.objects o ON o.object_id = cc.object_id
         JOIN {db}.sys.schemas s ON s.schema_id = o.schema_id
         JOIN {db}.sys.columns c ON c.object_id = cc.object_id AND c.column_id = cc.column_id
         WHERE s.name = @P1 AND o.name = @P2"
    ));
    let mut client = pool.get().await.map_err(|e| err!("error.mssql", message = e))?;
    let rows = client
        .query(sql, &[&schema, &table])
        .await
        .map_err(map_error)?
        .into_first_result()
        .await
        .map_err(map_error)?;

    Ok(rows
        .iter()
        .filter_map(|row| {
            let name: &str = row.get("name")?;
            let definition: &str = row.get("definition")?;
            Some((
                name.to_string(),
                ComputedDefinition {
                    definition: definition.to_string(),
                    persisted: row.get("is_persisted").unwrap_or(false),
                },
            ))
        })
        .collect())
}

/// A computed column's declaration: `name AS (expression)`, `PERSISTED` appended when the server
/// stores rather than recomputes it — the one distinction the spec's top-level phi mục tiêu says
/// the Structure tab does not let a user change, but a dump still has to spell correctly to
/// reproduce the table as it is.
fn computed_column_definition(name: &str, computed: &ComputedDefinition) -> String {
    let mut sql = format!("{} AS ({})", quote_ident(name), computed.definition);
    if computed.persisted {
        sql.push_str(" PERSISTED");
    }
    sql
}

/// Writes every base table's `CREATE TABLE` (columns and computed columns), its indexes, and — once
/// every table is written — every foreign key as a trailing `ALTER TABLE ... ADD CONSTRAINT` (a
/// later task in this plan fills [`write_foreign_keys`] in; this task leaves the call site for it).
///
/// Base tables only (`sys.objects.type = 'U'`, via [`mssql_structure::table_stats`], which already
/// excludes views for the same reason the Statistics tab does) — and no `CREATE SCHEMA`: a table
/// outside `dbo` restores only into a database where that schema already exists, matching
/// `mssql_ddl::create_table`'s own documented limit.
pub async fn dump_structure(
    pool: &Pool,
    database: &str,
    path: &str,
    watch: &dump::Watch<'_>,
) -> Result<(), AppError> {
    use std::io::Write;

    let tables = mssql_structure::table_stats(pool, database).await?;
    let weights: Vec<(String, u64)> = tables.iter().map(|t| (t.name.clone(), 1)).collect();
    let mut tracker = Tracker::new(&weights, path, false);

    let mut file = std::fs::File::create(path)
        .map_err(|e| err!("error.cannotWriteFile", path = path, message = e))?;
    write!(file, "-- MixDB structure dump\n\n")
        .map_err(|e| err!("error.cannotWriteFile", path = path, message = e))?;

    for table in &tables {
        if (watch.cancel)() {
            return Err(err!("error.transferCancelled", tool = "SQL Server dump"));
        }
        let (schema, name) = resolve(&table.name);
        let qualified = three_part(database, &schema, &name);
        let structure = mssql_structure::table_structure(pool, database, &table.name).await?;
        let computed = computed_definitions(pool, database, &schema, &name).await?;

        let mut column_lines = Vec::with_capacity(structure.columns.len());
        for column in &structure.columns {
            if column.generated {
                let Some(definition) = computed.get(&column.name) else {
                    // A computed column the catalogue no longer explains — dropped between the two
                    // reads, or a flavour `sys.computed_columns` does not cover. Skipped with the
                    // rest of the table intact rather than failing the whole dump over one column.
                    continue;
                };
                column_lines.push(computed_column_definition(&column.name, definition));
            } else {
                column_lines.push(column_definition(&column_spec_from(column))?);
            }
        }
        write!(file, "CREATE TABLE {qualified} (\n  {}\n);\n", column_lines.join(",\n  "))
            .map_err(|e| err!("error.cannotWriteFile", path = path, message = e))?;

        for column in &structure.columns {
            if let Some(stmt) =
                comment_statement(&schema, &name, &column.name, &column.comment, false)
            {
                write!(file, "{stmt};\n")
                    .map_err(|e| err!("error.cannotWriteFile", path = path, message = e))?;
            }
        }
        for index in &structure.indexes {
            let spec = index_spec_from(index);
            for stmt in create_index_statements(database, &schema, &name, &spec)? {
                write!(file, "{stmt};\n")
                    .map_err(|e| err!("error.cannotWriteFile", path = path, message = e))?;
            }
        }
        write!(file, "\n").map_err(|e| err!("error.cannotWriteFile", path = path, message = e))?;

        tracker.reached(&table.name);
        (watch.report)(tracker.progress());
    }

    write_foreign_keys(pool, database, &mut file, path).await
}

/// Forward-declared here, defined in a later task of this plan alongside the foreign-key catalogue
/// read.
async fn write_foreign_keys(
    _pool: &Pool,
    _database: &str,
    _file: &mut std::fs::File,
    _path: &str,
) -> Result<(), AppError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column(name: &str, data_type: &str) -> StructureColumn {
        StructureColumn {
            name: name.to_string(),
            data_type: data_type.to_string(),
            nullable: true,
            default_value: None,
            default_is_expression: false,
            auto_increment: false,
            on_update_current_timestamp: false,
            generated: false,
            collation: None,
            comment: String::new(),
            key: String::new(),
            extra: String::new(),
        }
    }

    #[test]
    fn column_spec_from_carries_every_field_through() {
        let mut col = column("price", "decimal(10,2)");
        col.default_value = Some("0".to_string());
        col.collation = Some("Latin1_General_CI_AS".to_string());
        col.comment = "unit price".to_string();

        let spec = column_spec_from(&col);
        assert_eq!(spec.name, "price");
        assert_eq!(spec.data_type, "decimal(10,2)");
        assert_eq!(spec.default_value.as_deref(), Some("0"));
        assert_eq!(spec.collation.as_deref(), Some("Latin1_General_CI_AS"));
        assert_eq!(spec.comment, "unit price");
    }

    #[test]
    fn a_persisted_computed_column_carries_the_keyword() {
        let def = ComputedDefinition { definition: "[a] + [b]".to_string(), persisted: true };
        assert_eq!(computed_column_definition("total", &def), "[total] AS ([a] + [b]) PERSISTED");
    }

    #[test]
    fn a_non_persisted_computed_column_does_not() {
        let def = ComputedDefinition { definition: "[a] + [b]".to_string(), persisted: false };
        assert_eq!(computed_column_definition("total", &def), "[total] AS ([a] + [b])");
    }
}
