import type { ModuleDefinition } from "../../shell/module";
import { DatabaseGenericIcon } from "../../icons";
import DbTab from "./DbTab";
import ToolsSection from "./components/ToolsSection";
import { DB_SHORTCUTS } from "./shortcuts";

/** Database: the module MixDB started as. */
export const dbModule: ModuleDefinition = {
  id: "db",
  labelKey: "app.moduleDatabase",
  Icon: DatabaseGenericIcon,
  defaultTitleKey: "app.newConnectionTitle",
  Tab: DbTab,
  /* Named after the module, like every other pane in that list — `labelKey` again rather than a
     second string saying the same word, so the pane and the `[+]` menu cannot drift apart.

     It was called "Dump tools" and wore a spanner, which read as one of the dialog's own errands
     sitting between two modules' panes rather than as the database module's. The dump tools are
     still all that is in there; they are a heading inside the pane now. */
  settings: { labelKey: "app.moduleDatabase", Icon: DatabaseGenericIcon, Section: ToolsSection },
  shortcuts: DB_SHORTCUTS,
};
