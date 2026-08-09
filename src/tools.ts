import { invoke } from "@tauri-apps/api/core";

/** The two downloads a tool can come from: each carries the pair of tools for its database. */
export type ToolSuite = "mysql" | "mongo";

/** Where a tool was found. `custom` is a path picked in Settings, `downloaded` a copy MixDB
 *  fetched for itself, and `system` something already installed on the machine. */
export type ToolSource = "custom" | "downloaded" | "system";

export interface ToolStatus {
  /** `mysqldump`, `mysql`, `mongodump` or `mongorestore`. */
  name: string;
  suite: ToolSuite;
  /** Where it is, or null when it is nowhere to be found. */
  path: string | null;
  source: ToolSource | null;
}

export function toolsStatus(): Promise<ToolStatus[]> {
  return invoke<ToolStatus[]>("tools_status");
}

/** Whether both of a suite's tools can be found — what the dump and restore buttons ask first. */
export function toolsReady(suite: ToolSuite): Promise<boolean> {
  return invoke<boolean>("tools_ready", { suite });
}

/** Downloads a suite from its vendor. Slow — tens of megabytes at best — and silent until done. */
export function toolsInstall(suite: ToolSuite): Promise<void> {
  return invoke<void>("tools_install", { suite });
}

/** Deletes MixDB's own copy. Tools found on the machine itself are left alone. */
export function toolsUninstall(suite: ToolSuite): Promise<void> {
  return invoke<void>("tools_uninstall", { suite });
}

/** Points one tool at a copy chosen by hand, or forgets that choice when given null. */
export function toolsSetPath(tool: string, path: string | null): Promise<void> {
  return invoke<void>("tools_set_path", { tool, path });
}
