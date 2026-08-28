import { useEffect, useState } from "react";
import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import ToolList from "./components/ToolList";
import { TOOLS } from "./registry";
import { parseToolsTabState } from "./tabState";
import "./tools.css";

function ToolsTab({ onTitleChange, onStateChange, restored }: ModuleTabProps) {
  const { t } = useTranslation();

  // Đọc `restored` đúng một lần, ở đây. Đọc nó reactively thì module ghi đè chính mình ngay lần
  // ghi đầu tiên — luật nằm trong `shell/module.ts`.
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const saved = parseToolsTabState(restored);
    if (saved && TOOLS.some((tool) => tool.id === saved.toolId)) return saved.toolId;
    return TOOLS[0]?.id ?? null;
  });

  const selected = TOOLS.find((tool) => tool.id === selectedId) ?? null;

  // Tiêu đề tab là tên tool, không phải "Tools": ba tab Tools mở cùng lúc thì phân biệt được.
  // `onTitleChange` không nằm trong deps — shell trả về một closure mới mỗi lần render, và
  // `shell/tabs.ts` gọi tên vòng lặp mà việc liệt kê nó tạo ra.
  useEffect(() => {
    onTitleChange(selected ? t(selected.labelKey) : t("toolbox.newTabTitle"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, t]);

  const pick = (id: string) => {
    setSelectedId(id);
    onStateChange({ toolId: id });
  };

  return (
    <div className="tools-tab">
      <aside className="tools-sidebar">
        <ToolList tools={TOOLS} selectedId={selectedId} onSelect={pick} />
      </aside>
      <div className="tools-pane">{selected ? <selected.Panel /> : null}</div>
    </div>
  );
}

export default ToolsTab;
