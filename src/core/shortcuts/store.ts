/** One handler, listening. Held as an object so a registration can be cancelled by identity —
 *  two panes may be listening for the same id at once, and removing "the one with this id" would
 *  take the wrong one down. */
export interface Registration {
  id: string;
  handler: () => void;
}

/**
 * Who is listening, and what is standing over them.
 *
 * A module-level singleton rather than a React context, the same shape `core/reload.ts` already
 * has: nothing here belongs in the render tree, and a provider wrapped round `App` would be
 * ceremony for a list two entries long.
 */
const registrations: Registration[] = [];
let depth = 0;

/** Starts listening; the returned function stops. Order matters — see {@link enabledIds}. */
export function register(registration: Registration): () => void {
  registrations.push(registration);
  return () => {
    const at = registrations.indexOf(registration);
    if (at >= 0) registrations.splice(at, 1);
  };
}

/** The ids listening, oldest first — the order `decide` breaks ties on. */
export function enabledIds(): string[] {
  return registrations.map((registration) => registration.id);
}

/** Runs the newest handler registered under `id`, which is the one `decide` picked. */
export function run(id: string): void {
  for (let i = registrations.length - 1; i >= 0; i -= 1) {
    if (registrations[i].id === id) {
      registrations[i].handler();
      return;
    }
  }
}

/** Marks a dialog or menu as up; the returned function marks it down again. Idempotent, so a
 *  disposer called twice — which is what StrictMode does to an effect — cannot unbalance the
 *  count. */
export function enterModal(): () => void {
  depth += 1;
  let left = false;
  return () => {
    if (left) return;
    left = true;
    depth -= 1;
  };
}

export function modalDepth(): number {
  return depth;
}
