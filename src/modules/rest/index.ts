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
  /* The same key the [+] menu is drawn from, because a REST tab is called REST for as long as
     it is open: there is no "before the module names it" here to have a second word for. */
  defaultTitleKey: "app.moduleRest",
  Tab: RestTab,
  settings: { labelKey: "rest.settingsTitle", Icon: GlobeIcon, Section: RestSettings },
  shortcuts: REST_SHORTCUTS,
};
