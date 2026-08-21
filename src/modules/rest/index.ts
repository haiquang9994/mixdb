import type { ModuleDefinition } from "../../shell/module";
import { GlobeIcon } from "../../icons";
import RestTab from "./RestTab";
import RestSettings from "./components/RestSettings";
import { REST_SHORTCUTS } from "./shortcuts";

/** REST client: composing an HTTP request, sending it, and reading what came back. */
export const restModule: ModuleDefinition = {
  id: "rest",
  labelKey: "app.moduleRest",
  Icon: GlobeIcon,
  defaultTitleKey: "rest.newTabTitle",
  Tab: RestTab,
  settings: { labelKey: "rest.settingsTitle", Icon: GlobeIcon, Section: RestSettings },
  shortcuts: REST_SHORTCUTS,
};
