import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select, { type SelectOption } from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import CopyField from "../../components/CopyField";
import { listeningPorts, type ListeningPort } from "./api";
import { hostOs, killByPid, killByPort, type KillOs } from "./kill";
import styles from "./Panel.module.css";

/** Nhãn là tên hệ điều hành, nên không dịch. */
const OSES: SelectOption<KillOs>[] = [
  { value: "macos", label: "macOS" },
  { value: "linux", label: "Linux" },
  { value: "windows", label: "Windows" },
];

function PortsPanel() {
  const { t } = useTranslation();
  const [ports, setPorts] = useState<ListeningPort[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ListeningPort | null>(null);
  // Mặc định theo máy đang chạy, nhưng đổi tay được: người ngồi Windows vẫn hay cần lệnh Linux.
  const [os, setOs] = useState<KillOs>(hostOs);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    setError(null);
    void listeningPorts()
      .then((rows) => {
        setPorts(rows);
        // Cổng đang chọn có thể đã đóng giữa hai lần tải.
        setSelected((current) =>
          current && rows.some((row) => row.pid === current.pid && row.port === current.port)
            ? current
            : null,
        );
      })
      .catch((e: unknown) => {
        setError(errorMessage(t, e));
        setPorts([]);
      })
      .finally(() => setBusy(false));
    // `t` không nằm trong deps: nó đổi khi người dùng đổi ngôn ngữ, và một lần quét lại vì
    // chuyện đó là quét thừa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  const shown = useMemo(() => {
    const rows = ports ?? [];
    const needle = filter.trim();
    if (needle === "") return rows;
    return rows.filter((row) => String(row.port).includes(needle));
  }, [ports, filter]);

  return (
    <div className={styles.panel}>
      <div className={styles.controls}>
        <Button variant="primary" onClick={load} disabled={busy}>
          {busy ? t("common.loading") : t("toolbox.ports.refresh")}
        </Button>
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("toolbox.ports.filter")}
          aria-label={t("toolbox.ports.filter")}
          className={styles.filter}
        />
        <Select
          value={os}
          options={OSES}
          onChange={setOs}
          ariaLabel={t("toolbox.ports.os")}
          className={styles.os}
        />
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {ports !== null && ports.length === 0 && !error ? (
        <p className={styles.note}>{t("toolbox.ports.empty")}</p>
      ) : null}

      {shown.length === 0 && (ports?.length ?? 0) > 0 ? (
        <p className={styles.note}>{t("toolbox.ports.noMatch")}</p>
      ) : null}

      {shown.length > 0 ? (
        <div className={styles.table}>
          <div className={`${styles.row} ${styles.head}`}>
            <span>{t("toolbox.ports.colPort")}</span>
            <span>{t("toolbox.ports.colAddress")}</span>
            <span>{t("toolbox.ports.colPid")}</span>
            <span>{t("toolbox.ports.colProcess")}</span>
          </div>
          {shown.map((row) => {
            const isSelected = selected?.pid === row.pid && selected?.port === row.port;
            return (
              <button
                key={`${row.address}:${row.port}:${row.pid}`}
                type="button"
                className={isSelected ? `${styles.row} ${styles.selected}` : styles.row}
                aria-current={isSelected ? "true" : undefined}
                onClick={() => setSelected(row)}
              >
                <span>{row.port}</span>
                <span>{row.address}</span>
                <span>{row.pid}</span>
                <span className={row.process ? undefined : styles.dim}>
                  {row.process ?? t("toolbox.ports.unknownProcess")}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {selected ? (
        <>
          <CopyField
            label={`${t("toolbox.ports.byPid")} · ${selected.pid}`}
            value={killByPid(os, selected.pid)}
          />
          <CopyField
            label={`${t("toolbox.ports.byPort")} · ${selected.port}`}
            value={killByPort(os, selected.port)}
          />
          <p className={styles.note}>{t("toolbox.ports.note")}</p>
        </>
      ) : null}
    </div>
  );
}

export default PortsPanel;
