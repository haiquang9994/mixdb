# Adding a backend command

A new backend call touches five places. Miss one and it fails at runtime, not at build time.

1. **Implement it** in the right `src-tauri/src/db/*.rs` module, taking the driver handle
   (`&MySqlPool`, `&mongodb::Client`, `&mut MultiplexedConnection`) as its first argument and
   returning `Result<T, String>`.

2. **Wrap it** in `src-tauri/src/commands.rs` as a `#[tauri::command]` that takes
   `state: State<'_, AppState>` plus `id: String`, locks `state.connections`, matches the handle
   against the expected `DbHandle` variant, and delegates. Copy the skeleton in
   [../architecture/backend.md](../architecture/backend.md) — the two error strings for a wrong kind
   and an unknown id are the same everywhere.

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
