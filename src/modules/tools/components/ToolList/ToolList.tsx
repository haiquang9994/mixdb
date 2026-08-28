import { useTranslation, type TranslationKey } from "../../../../i18n";
import { TOOL_GROUPS, type ToolDefinition, type ToolGroup } from "../../tool";
import styles from "./ToolList.module.css";

const GROUP_LABEL: Record<ToolGroup, TranslationKey> = {
  data: "toolbox.groupData",
  encode: "toolbox.groupEncode",
  time: "toolbox.groupTime",
  infra: "toolbox.groupInfra",
  text: "toolbox.groupText",
};

interface ToolListProps {
  tools: ToolDefinition[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Danh sách tool có nhóm.
 *
 * Riêng của module thay vì `components/ItemList`: cái kia nhận một mảng chuỗi phẳng và gánh cả
 * tìm kiếm, ghim và menu chuột phải — thứ một danh sách cố định gồm mười mấy nhãn ta tự viết
 * không cần, và nống nó ra cho đúng một người dùng thì hại nhiều hơn lợi.
 */
function ToolList({ tools, selectedId, onSelect }: ToolListProps) {
  const { t } = useTranslation();
  if (tools.length === 0) return <p className={styles.empty}>{t("toolbox.empty")}</p>;

  return (
    <nav className={styles.list} aria-label={t("toolbox.list")}>
      {TOOL_GROUPS.map((group) => {
        const inGroup = tools.filter((tool) => tool.group === group);
        if (inGroup.length === 0) return null;
        return (
          <section key={group} className={styles.group}>
            <h2 className={styles.groupTitle}>{t(GROUP_LABEL[group])}</h2>
            {inGroup.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className={tool.id === selectedId ? `${styles.item} ${styles.selected}` : styles.item}
                aria-current={tool.id === selectedId ? "true" : undefined}
                onClick={() => onSelect(tool.id)}
              >
                {t(tool.labelKey)}
              </button>
            ))}
          </section>
        );
      })}
    </nav>
  );
}

export default ToolList;
