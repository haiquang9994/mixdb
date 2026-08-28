import { useMemo, useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select, { type SelectOption } from "../../../../components/Select";
import { useTranslation } from "../../../../i18n";
import CopyField from "../../components/CopyField";
import { detectUnit, toInstant, toOutputs } from "./time";
import styles from "./Panel.module.css";

const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/* `Intl.supportedValuesOf` là ES2022, còn `lib` của dự án là ES2020, nên nó không có trong kiểu —
   dò lấy ở đây thay vì nới `lib` cho cả repo vì đúng một lời gọi. Webview nào cũng có nó; đường
   lui về một mục là để danh sách không bao giờ rỗng, chứ không phải vì có runtime nào thiếu. */
const intlZones = (Intl as { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;

/* Tính một lần ở tầng module: hàng trăm mục, và không đổi trong suốt một phiên chạy. */
const ZONES: SelectOption<string>[] = (intlZones ? intlZones("timeZone") : [LOCAL_ZONE]).map(
  (zone) => ({ value: zone, label: zone }),
);

function TimestampPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState(() => String(Date.now()));
  const [zone, setZone] = useState(LOCAL_ZONE);
  // Đóng băng "bây giờ" thay vì để nó nhảy mỗi giây: dòng "3 ngày trước" mà tự đổi trong lúc
  // người ta đang đọc thì khó chịu hơn là hữu ích. Nút "Bây giờ" làm mới cả hai.
  const [now, setNow] = useState(() => Date.now());

  const unit = detectUnit(input);
  const instant = toInstant(input);
  const outputs = useMemo(
    () => (instant === null ? null : toOutputs(instant, zone, now)),
    [instant, zone, now],
  );

  const guess =
    unit === "seconds"
      ? t("toolbox.timestamp.guessedSeconds")
      : unit === "millis"
        ? t("toolbox.timestamp.guessedMillis")
        : unit === "micros"
          ? t("toolbox.timestamp.guessedMicros")
          : instant !== null
            ? t("toolbox.timestamp.guessedIso")
            : null;

  return (
    <div className={styles.panel}>
      <div className={styles.controls}>
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-label={t("toolbox.timestamp.value")}
          placeholder={t("toolbox.timestamp.placeholder")}
          className={styles.input}
        />
        <Button
          onClick={() => {
            const stamp = Date.now();
            setNow(stamp);
            setInput(String(stamp));
          }}
        >
          {t("toolbox.timestamp.now")}
        </Button>
        <Select
          value={zone}
          options={ZONES}
          onChange={setZone}
          ariaLabel={t("toolbox.timestamp.timeZone")}
          className={styles.zone}
        />
      </div>

      {guess ? <p className={styles.guess}>{guess}</p> : null}

      {outputs ? (
        <div className={styles.results}>
          <CopyField label={t("toolbox.timestamp.isoUtc")} value={outputs.isoUtc} />
          <CopyField label={t("toolbox.timestamp.isoLocal")} value={outputs.isoLocal} />
          <CopyField label={t("toolbox.timestamp.unixSeconds")} value={outputs.unixSeconds} />
          <CopyField label={t("toolbox.timestamp.unixMillis")} value={outputs.unixMillis} />
          <CopyField label={t("toolbox.timestamp.relative")} value={outputs.relative} mono={false} />
        </div>
      ) : (
        <p className={styles.unreadable}>{t("toolbox.timestamp.unreadable")}</p>
      )}
    </div>
  );
}

export default TimestampPanel;
