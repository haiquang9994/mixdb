import { createStore, jsonFile, useStore } from "../../core/jsonStore";
import { clearUse, rankFrequentTools, recordUse, sanitizeUsage, type ToolUsage } from "./usage";

/**
 * Tool-open history, shared across every Tools tab and kept between app runs.
 *
 * Mechanics live in `core/jsonStore.ts`; what is specific here is sanitizing on the way in, since
 * `tool-usage.json` is a file a person can hand-edit.
 */

const file = jsonFile<ToolUsage>("tool-usage.json", "usage", {});

const shared = createStore<ToolUsage>({
  defaults: {},
  load: async () => sanitizeUsage(await file.load()),
  persist: file.persist,
});

function write(next: ToolUsage): void {
  // On screen first, disk second — a failed write here just means the next app run starts the
  // window over, not something worth surfacing to the user.
  void shared.save(next).catch(() => {});
}

/** Marks `toolId` as opened right now. Called once per pick, not on tab restore — a tool a tab
 *  merely reopens on launch was not chosen again, it was already open. */
export function recordToolUse(toolId: string): void {
  write(recordUse(shared.get(), toolId));
}

/** Drops `toolId` out of the "Frequently used" ranking without touching the tool itself. */
export function clearToolUse(toolId: string): void {
  write(clearUse(shared.get(), toolId));
}

/** The `limit` tools opened most in the last 30 days, most-used first. */
export function useFrequentTools(limit: number): string[] {
  const usage = useStore(shared);
  return rankFrequentTools(usage, limit);
}
