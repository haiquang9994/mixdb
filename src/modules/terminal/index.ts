import type { ModuleDefinition } from "../../shell/module";
import { TerminalIcon } from "../../icons";
import TerminalTab from "./TerminalTab";
import TerminalSettings from "./components/TerminalSettings";
import { TERMINAL_SHORTCUTS } from "./shortcuts";

/** Terminal: một phiên shell trên máy này, hoặc — từ đợt 2 — trên một máy chủ qua SSH. */
export const terminalModule: ModuleDefinition = {
  id: "terminal",
  labelKey: "app.moduleTerminal",
  Icon: TerminalIcon,
  defaultTitleKey: "terminal.newTabTitle",
  Tab: TerminalTab,
  settings: { labelKey: "terminal.settingsTitle", Icon: TerminalIcon, Section: TerminalSettings },
  shortcuts: TERMINAL_SHORTCUTS,
};
