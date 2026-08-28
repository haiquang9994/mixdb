import type { ToolDefinition } from "./tool";
import CasePanel from "./tools/case/Panel";
import EncodePanel from "./tools/encode/Panel";
import IdsPanel from "./tools/ids/Panel";
import JwtPanel from "./tools/jwt/Panel";
import TimestampPanel from "./tools/timestamp/Panel";

/** Mọi tool module này có. Thêm một tool là một dòng ở đây — và file này là chỗ duy nhất
 *  `ToolsTab` học được tool nào tồn tại. */
export const TOOLS: ToolDefinition[] = [
  { id: "timestamp", labelKey: "toolbox.timestamp.label", group: "time", Panel: TimestampPanel },
  { id: "case", labelKey: "toolbox.case.label", group: "text", Panel: CasePanel },
  { id: "ids", labelKey: "toolbox.ids.label", group: "data", Panel: IdsPanel },
  { id: "encode", labelKey: "toolbox.encode.label", group: "encode", Panel: EncodePanel },
  { id: "jwt", labelKey: "toolbox.jwt.label", group: "encode", Panel: JwtPanel },
];
