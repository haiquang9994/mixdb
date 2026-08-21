import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { localShells } from "../../api";
import { shellLabel } from "../../shells";
import type { LocalShell, TerminalChoice } from "../../types";
import styles from "./TargetForm.module.css";

interface Props {
  onOpen: (choice: TerminalChoice) => void;
  onError: (message: string) => void;
}

/** Màn hình một tab terminal hiện trước khi có phiên. Đợt 2 thêm nhánh SSH bên cạnh nhánh này. */
function TargetForm({ onOpen, onError }: Props) {
  const { t } = useTranslation();
  const [shells, setShells] = useState<LocalShell[]>([]);
  const [path, setPath] = useState("");
  const [cwd, setCwd] = useState("");

  useEffect(() => {
    localShells()
      .then((found) => {
        setShells(found);
        // Cái đầu tiên là cái Rust gợi ý, và cũng là cái `default_shell()` sẽ chọn.
        if (found[0]) setPath(found[0].path);
      })
      .catch((e) => onError(errorMessage(t, e)));
    // Chỉ chạy một lần: danh sách shell của một máy không đổi giữa chừng.
  }, []);

  const chosen = shells.find((shell) => shell.path === path);

  async function browse() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") setCwd(picked);
  }

  return (
    <div className={styles.form}>
      <div className={styles.row}>
        {/* `Select` không nhận `id`, nên nhãn của nó là `ariaLabel` chứ không phải `htmlFor` */}
        <span>{t("terminal.shell")}</span>
        <Select
          value={path}
          options={shells.map((shell) => ({ value: shell.path, label: shellLabel(shell.name) }))}
          onChange={setPath}
          ariaLabel={t("terminal.shell")}
          placeholder={t("terminal.noShells")}
        />
      </div>

      <div className={styles.row}>
        <label htmlFor="terminal-cwd">{t("terminal.startIn")}</label>
        <div className={styles.cwd}>
          <Input
            id="terminal-cwd"
            value={cwd}
            placeholder={t("terminal.startInPlaceholder")}
            onChange={(e) => setCwd(e.target.value)}
          />
          <Button onClick={() => void browse()}>{t("terminal.browse")}</Button>
        </div>
      </div>

      <Button
        variant="primary"
        disabled={!chosen}
        onClick={() => chosen && onOpen({ kind: "local", shell: chosen, cwd: cwd.trim() || null })}
      >
        {t("terminal.open")}
      </Button>
    </div>
  );
}

export default TargetForm;
