# Adding a backend command

A new backend call touches five places. Miss one and it fails at runtime, not at build time.

1. **Implement it** in the right `src-tauri/src/db/*.rs` module, taking the driver handle
   (`&MySqlPool`, `&mongodb::Client`, `&mut ConnectionManager`) as its first argument and
   returning `Result<T, String>`.

2. **Wrap it** in `src-tauri/src/commands.rs` as a `#[tauri::command]` that takes
   `state: State<'_, AppState>` plus `id: String`, gets the handle from `mysql_pool` /
   `mongo_client` / `redis_connection`, and delegates:

   ```rust
   let pool = mysql_pool(&state, &id).await?;
   mysql::list_tables(&pool, &database).await
   ```

   Those helpers release the connection-map lock before returning. Do not lock
   `state.connections` in a command yourself — a query awaited while holding it blocks every other
   command in the app, in every tab.

3. **Register it** in the `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs`. This is
   the step that's easy to forget; without it `invoke` rejects the call with "command not found".

4. **Expose it** as a typed function in `src/<db>/api.ts`. One exported function per command, its
   doc comment carrying the semantics a caller needs (what a null means, whether paging is stable,
   whether the call is sticky). Nothing outside `api.ts` calls `invoke`.

5. **Type the payload** in `src/types.ts` if it returns or accepts a struct. Nothing verifies the
   Rust and TypeScript shapes agree — changing one means changing the other by hand.

## Argument naming

Tauri converts camelCase JS arguments to snake_case Rust parameters. Write `pageSize` in
`invoke(...)` and `page_size: u32` in Rust. Struct *fields* are not converted (serde doesn't rename
them here), so `ConnectionConfig.use_ssl` is snake_case on both sides.

## Verify

`npm run build` typechecks the frontend; `npm run dev:app` builds the Rust side and is the only way
to actually exercise the command.
