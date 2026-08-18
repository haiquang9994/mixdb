import type { ModuleDefinition } from "../../shell/module";
import { DatabaseGenericIcon, WrenchIcon } from "../../icons";
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
  /* The dump tools are `mysqldump`, `pg_dump` and `mongodump` — this module's business, shown in
     the app's Settings because that is where a download belongs, not because the shell owns them. */
  settings: { labelKey: "tools.title", Icon: WrenchIcon, Section: ToolsSection },
  shortcuts: DB_SHORTCUTS,
};
