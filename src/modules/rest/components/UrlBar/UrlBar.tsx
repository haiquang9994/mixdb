import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { SendIcon, StopIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { METHODS, type Method } from "../../types";
import styles from "./UrlBar.module.css";

interface Props {
  method: Method;
  url: string;
  /** While this is true the button cancels instead of sending. */
  sending: boolean;
  onMethodChange: (method: Method) => void;
  onUrlChange: (url: string) => void;
  onSend: () => void;
  onCancel: () => void;
}

/** The top row of the request pane: what to send, where, and the one button that does it. */
function UrlBar({ method, url, sending, onMethodChange, onUrlChange, onSend, onCancel }: Props) {
  const { t } = useTranslation();

  return (
    <div className={styles.bar}>
      <Select<Method>
        className={styles.method}
        value={method}
        options={METHODS.map((m) => ({ value: m, label: m }))}
        onChange={onMethodChange}
        ariaLabel={t("rest.method")}
        size="small"
      />
      <Input
        className={styles.url}
        value={url}
        placeholder={t("rest.urlPlaceholder")}
        aria-label={t("rest.urlPlaceholder")}
        onChange={(e) => onUrlChange(e.target.value)}
        // Enter in the URL box is the oldest gesture there is for "go".
        onKeyDown={(e) => {
          if (e.key === "Enter" && !sending) onSend();
        }}
      />
      <Button
        className={styles.send}
        variant="primary"
        onClick={sending ? onCancel : onSend}
        // Only the URL is required. A GET with nothing else filled in is a whole request.
        disabled={!sending && url.trim() === ""}
      >
        {sending ? <StopIcon size="1em" /> : <SendIcon size="1em" />}
        {sending ? t("rest.cancel") : t("rest.send")}
      </Button>
    </div>
  );
}

export default UrlBar;
