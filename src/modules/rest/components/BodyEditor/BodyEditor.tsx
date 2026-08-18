import Button from "../../../../components/Button";
import Select from "../../../../components/Select";
import { FormatIcon } from "../../../../icons";
import { useTranslation, type TranslationKey } from "../../../../i18n";
import { prettyJson } from "../../format";
import { RAW_LANGUAGES, rawLanguage } from "../../types";
import type { Body, RawLanguage } from "../../types";
import styles from "./BodyEditor.module.css";

interface Props {
  body: Body;
  onChange: (body: Body) => void;
}

/** What the one picker is set to: no body, or the notation the text is written in. */
type Choice = "none" | RawLanguage;

const LABELS: Record<Choice, TranslationKey> = {
  none: "rest.bodyNone",
  json: "rest.langJson",
  xml: "rest.langXml",
  yaml: "rest.langYaml",
  text: "rest.langText",
};

/**
 * The Body tab.
 *
 * One picker, not two. A body is either absent or a string in some notation, and asking "which
 * kind?" and then "which language?" made the user answer a question whose only real answer was
 * the second one. Form, multipart and binary are Phase 3; `Body` already holds them and
 * `buildRequest` already puts them on the wire, so they join this list and nothing else changes.
 *
 * A plain `<textarea>` rather than the shared one, which grows to fit its text: this pane has a
 * height of its own and the box should fill it, not push the layout about as a body is pasted in.
 */
function BodyEditor({ body, onChange }: Props) {
  const { t } = useTranslation();

  const choice: Choice = body.kind === "raw" ? rawLanguage(body.language) : "none";
  const options = (["none", ...RAW_LANGUAGES] as Choice[]).map((value) => ({
    value,
    label: t(LABELS[value]),
  }));

  /** Switching notation keeps the text: it is the same body, described differently. Only leaving
   *  for None drops it, and coming back from None starts empty. */
  function pick(next: Choice) {
    if (next === "none") {
      onChange({ kind: "none" });
      return;
    }
    onChange({ kind: "raw", language: next, text: body.kind === "raw" ? body.text : "" });
  }

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <Select<Choice>
          className={styles.kind}
          size="small"
          value={choice}
          ariaLabel={t("rest.bodyKind")}
          options={options}
          onChange={pick}
        />
        {choice === "json" && body.kind === "raw" && (
          <Button size="small" onClick={() => onChange({ ...body, text: prettyJson(body.text) })}>
            <FormatIcon size="1em" />
          </Button>
        )}
      </div>
      {body.kind === "raw" ? (
        <textarea
          className={styles.text}
          value={body.text}
          placeholder={t("rest.bodyPlaceholder")}
          aria-label={t("rest.bodyTab")}
          spellCheck={false}
          onChange={(e) => onChange({ ...body, text: e.target.value })}
        />
      ) : (
        <p className={`${styles.empty} muted`}>{t("rest.bodyNone")}</p>
      )}
    </div>
  );
}

export default BodyEditor;
