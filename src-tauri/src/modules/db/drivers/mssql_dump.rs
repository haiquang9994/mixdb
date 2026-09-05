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

/// One foreign key constraint in full — every column of a composite key, and the referential
/// action either side declares — read once for the whole database rather than once per table:
/// `mssql::foreign_keys` (used to decorate the Data tab's grid) answers "what does this column
/// point at", one row per column, which loses which columns of a composite key belong together and
/// drops the constraint's name and its `ON DELETE`/`ON UPDATE` entirely.
struct ForeignKeyConstraint {
    name: String,
    schema: String,
    table: String,
    columns: Vec<String>,
    ref_schema: String,
    ref_table: String,
    ref_columns: Vec<String>,
    on_delete: String,
    on_update: String,
}

async fn foreign_key_constraints(
    pool: &Pool,
    database: &str,
) -> Result<Vec<ForeignKeyConstraint>, AppError> {
    let db = quote_ident(database);
    let sql = read_uncommitted(&format!(
        "SELECT fk.name AS constraint_name, ps.name AS schema_name, po.name AS table_name,
                rs.name AS ref_schema_name, ro.name AS ref_table_name,
                pc.name AS column_name, rc.name AS ref_column_name,
                fk.delete_referential_action_desc, fk.update_referential_action_desc
         FROM {db}.sys.foreign_keys fk
         JOIN {db}.sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
         JOIN {db}.sys.objects po ON po.object_id = fk.parent_object_id
         JOIN {db}.sys.schemas ps ON ps.schema_id = po.schema_id
         JOIN {db}.sys.columns pc
             ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
         JOIN {db}.sys.objects ro ON ro.object_id = fk.referenced_object_id
         JOIN {db}.sys.schemas rs ON rs.schema_id = ro.schema_id
         JOIN {db}.sys.columns rc
             ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
         ORDER BY fk.name, fkc.constraint_column_id"
    ));
    let mut client = pool.get().await.map_err(|e| err!("error.mssql", message = e))?;
    let rows = client
        .query(sql, &[])
        .await
        .map_err(map_error)?
        .into_first_result()
        .await
        .map_err(map_error)?;

    let mut constraints: Vec<ForeignKeyConstraint> = Vec::new();
    for row in &rows {
        let Some(name) = row.get::<&str, _>("constraint_name") else {
            continue;
        };
        if constraints.last().map(|last| last.name != name).unwrap_or(true) {
            constraints.push(ForeignKeyConstraint {
                name: name.to_string(),
                schema: row.get::<&str, _>("schema_name").unwrap_or("").to_string(),
                table: row.get::<&str, _>("table_name").unwrap_or("").to_string(),
                ref_schema: row.get::<&str, _>("ref_schema_name").unwrap_or("").to_string(),
                ref_table: row.get::<&str, _>("ref_table_name").unwrap_or("").to_string(),
                columns: Vec::new(),
                ref_columns: Vec::new(),
                on_delete: row
                    .get::<&str, _>("delete_referential_action_desc")
                    .unwrap_or("NO_ACTION")
                    .to_string(),
                on_update: row
                    .get::<&str, _>("update_referential_action_desc")
                    .unwrap_or("NO_ACTION")
                    .to_string(),
            });
        }
        if let Some(fk) = constraints.last_mut() {
            if let Some(col) = row.get::<&str, _>("column_name") {
                fk.columns.push(col.to_string());
            }
            if let Some(col) = row.get::<&str, _>("ref_column_name") {
                fk.ref_columns.push(col.to_string());
            }
        }
    }
    Ok(constraints)
}

/// `sys.foreign_keys`' own spelling (`NO_ACTION`, `CASCADE`, `SET_NULL`, `SET_DEFAULT`) turned into
/// what `ON DELETE`/`ON UPDATE` actually takes — an underscore standing in for the one space
/// `NO ACTION` needs, and a name this file does not recognise falling back to `NO ACTION` rather
/// than failing the dump over a value only a SQL Server version newer than this code knows about.
fn referential_action(desc: &str) -> &'static str {
    match desc {
        "CASCADE" => "CASCADE",
        "SET_NULL" => "SET NULL",
        "SET_DEFAULT" => "SET DEFAULT",
        _ => "NO ACTION",
    }
}

fn foreign_key_statement(database: &str, fk: &ForeignKeyConstraint) -> String {
    let qualified = three_part(database, &fk.schema, &fk.table);
    let ref_qualified = three_part(database, &fk.ref_schema, &fk.ref_table);
    let columns = fk.columns.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", ");
    let ref_columns = fk.ref_columns.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", ");
    format!(
        "ALTER TABLE {qualified} ADD CONSTRAINT {} FOREIGN KEY ({columns}) \
         REFERENCES {ref_qualified} ({ref_columns}) ON DELETE {} ON UPDATE {}",
        quote_ident(&fk.name),
        referential_action(&fk.on_delete),
        referential_action(&fk.on_update)
    )
}

/// Every foreign key of the database, added after every table exists — no topological sort of
/// tables by dependency (a self-referencing table or a two-table cycle would deadlock one), the
/// same trade dump tools that defer constraints to the end rather than order `CREATE TABLE` by
/// dependency already make.
async fn write_foreign_keys(
    pool: &Pool,
    database: &str,
    file: &mut std::fs::File,
    path: &str,
) -> Result<(), AppError> {
    use std::io::Write;

    let constraints = foreign_key_constraints(pool, database).await?;
    if constraints.is_empty() {
        return Ok(());
    }
    write!(file, "-- Foreign keys\n\n")
        .map_err(|e| err!("error.cannotWriteFile", path = path, message = e))?;
    for fk in &constraints {
        write!(file, "{};\n", foreign_key_statement(database, fk))
            .map_err(|e| err!("error.cannotWriteFile", path = path, message = e))?;
    }
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

    #[test]
    fn referential_action_translates_every_known_value() {
        assert_eq!(referential_action("CASCADE"), "CASCADE");
        assert_eq!(referential_action("SET_NULL"), "SET NULL");
        assert_eq!(referential_action("SET_DEFAULT"), "SET DEFAULT");
        assert_eq!(referential_action("NO_ACTION"), "NO ACTION");
    }

    #[test]
    fn an_unrecognised_action_falls_back_to_no_action() {
        assert_eq!(referential_action("SOMETHING_FUTURE"), "NO ACTION");
    }

    #[test]
    fn a_composite_foreign_key_lists_every_column_in_order() {
        let fk = ForeignKeyConstraint {
            name: "FK_order_item_order".to_string(),
            schema: "dbo".to_string(),
            table: "order_item".to_string(),
            columns: vec!["order_id".to_string(), "order_line".to_string()],
            ref_schema: "dbo".to_string(),
            ref_table: "order".to_string(),
            ref_columns: vec!["id".to_string(), "line".to_string()],
            on_delete: "CASCADE".to_string(),
            on_update: "NO_ACTION".to_string(),
        };
        assert_eq!(
            foreign_key_statement("mixdb_agent_test", &fk),
            "ALTER TABLE [mixdb_agent_test].[dbo].[order_item] \
             ADD CONSTRAINT [FK_order_item_order] FOREIGN KEY ([order_id], [order_line]) \
             REFERENCES [mixdb_agent_test].[dbo].[order] ([id], [line]) \
             ON DELETE CASCADE ON UPDATE NO ACTION"
        );
    }
}
