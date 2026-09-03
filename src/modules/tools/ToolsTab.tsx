import { useEffect, useState } from "react";
import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import Input from "../../components/Input";
import ToolList from "./components/ToolList";
import { TOOLS } from "./registry";
import { parseToolsTabState } from "./tabState";
import { recordToolUse } from "./usageStore";
import "./tools.css";

function ToolsTab({ onTitleChange, onStateChange, restored }: ModuleTabProps) {
  const { t, lang } = useTranslation();
  const [query, setQuery] = useState("");

  // Đọc `restored` đúng một lần, ở đây. Đọc nó reactively thì module ghi đè chính mình ngay lần
  // ghi đầu tiên — luật nằm trong `shell/module.ts`.
  // No tool by default — only a saved pick from a previous run reopens one. A fresh tab lands on
  // the empty prompt instead of steering everyone toward whichever tool sits first in the registry.
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const saved = parseToolsTabState(restored);
    if (saved && TOOLS.some((tool) => tool.id === saved.toolId)) return saved.toolId;
    return null;
  });

  const selected = TOOLS.find((tool) => tool.id === selectedId) ?? null;

  // Tiêu đề tab là tên tool, không phải "Tools": ba tab Tools mở cùng lúc thì phân biệt được.
  // `onTitleChange` không nằm trong deps — shell trả về một closure mới mỗi lần render, và
  // `shell/tabs.ts` gọi tên vòng lặp mà việc liệt kê nó tạo ra.
  // `lang` bên cạnh `t`: `t` là một hàm duy nhất suốt vòng đời app, nên `lang` mới là thứ báo
  // hiệu chữ đã đổi và title cần dựng lại. Xem `i18n/index.tsx`.
  useEffect(() => {
    onTitleChange(selected ? t(selected.labelKey) : t("toolbox.newTabTitle"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, t, lang]);

  const pick = (id: string) => {
    setSelectedId(id);
    onStateChange({ toolId: id });
    recordToolUse(id);
  };

  return (
    <div className="tools-tab">
      <aside className="tools-sidebar">
        <Input
          size="normal"
          allowClear
          className="tools-sidebar-search"
          placeholder={t("toolbox.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="tools-sidebar-list">
          <ToolList tools={TOOLS} selectedId={selectedId} onSelect={pick} query={query} />
        </div>
      </aside>
      <div className="tools-pane">
        {selected ? <selected.Panel /> : <p className="muted">{t("toolbox.selectPrompt")}</p>}
      </div>
    </div>
  );
}

export default ToolsTab;
