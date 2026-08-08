# Component folder structure

Every component lives in its own folder under `src/components/`, named after the component (PascalCase).

The folder contains:
- `ComponentName.tsx` — the component implementation.
- `ComponentName.module.css` — the component's styles, following [[css-modules]].
- `index.ts` — re-exports the component as the folder's public entry point.

Consumers must import the component via the folder path only, never by reaching into `ComponentName.tsx` directly. This keeps the folder's internal file layout free to change without breaking callers.
