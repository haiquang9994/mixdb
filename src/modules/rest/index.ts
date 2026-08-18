import type { ModuleDefinition } from "../../shell/module";
import { GlobeIcon } from "../../icons";
import RestTab from "./RestTab";

/** REST client: composing an HTTP request, sending it, and reading what came back. */
export const restModule: ModuleDefinition = {
  id: "rest",
  labelKey: "app.moduleRest",
  Icon: GlobeIcon,
  defaultTitleKey: "rest.newTabTitle",
  Tab: RestTab,
};
