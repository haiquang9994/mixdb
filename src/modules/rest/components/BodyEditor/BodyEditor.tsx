import Button from "../../../../components/Button";
import Select from "../../../../components/Select";
import { FormatIcon } from "../../../../icons";
import { useTranslation, type TranslationKey } from "../../../../i18n";
import { prettyJson } from "../../format";
import { RAW_LANGUAGES, rawLanguage } from "../../types";
import type { Body, MultipartField, RawLanguage } from "../../types";
import styles from "./BodyEditor.module.css";

interface Props {
  body: Body;
  onChange: (body: Body) => void;
}

/** What the one picker is set to: no body, the notation the text is written in, or one of the three
 *  kinds this pane can so far only show. */
type Choice = "none" | RawLanguage | "form" | "multipart" | "binary";

const LABELS: Record<Choice, TranslationKey> = {
  none: "rest.bodyNone",
  json: "rest.langJson",
  xml: "rest.langXml",
  yaml: "rest.langYaml",
  text: "rest.langText",
  form: "rest.bodyForm",
  multipart: "rest.bodyMultipart",
  binary: "rest.bodyBinary",
};

/** The kinds this pane can make and change. The other three arrive by paste, or from a file written
 *  by a later version, and are shown rather than edited until Phase 3 gives them a table. */
const EDITABLE: Choice[] = ["none", ...RAW_LANGUAGES];

/**
 * The rows to show for a body this pane cannot edit, or null when it can.
 *
 * Read as multipart fields throughout, since a plain form field is simply one without a file, and a
 * binary body is one file with no name of its own.
 */
function readOnlyFields(body: Body): MultipartField[] | null {
  if (body.kind === "form" || body.kind === "multipart") return body.fields;
  if (body.kind === "binary") {
    return [{ id: "file", enabled: true, key: "", value: "", file: body.filePath }];
  }
  return null;
}

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

  const choice: Choice = body.kind === "raw" ? rawLanguage(body.language) : body.kind;
  const shown = readOnlyFields(body);
  const options = (EDITABLE.includes(choice) ? EDITABLE : [...EDITABLE, choice]).map((value) => ({
    value,
    label: t(LABELS[value]),
    /* The kind a pasted body turned out to be is listed so the picker is not silently wrong about
       what is being sent, and cannot be chosen — there would be nothing to put in it. */
    disabled: !EDITABLE.includes(value),
  }));

  /** Switching notation keeps the text: it is the same body, described differently. Only leaving
   *  for None drops it, and coming back from None starts empty. */
  function pick(next: Choice) {
    if (next === "none") {
      onChange({ kind: "none" });
      return;
    }
    // The three kinds with no editor are offered as disabled options, so the picker never hands one
    // back. Saying so out loud is also what leaves `next` as a notation below.
    if (next === "form" || next === "multipart" || next === "binary") return;
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
      ) : shown === null ? (
        <p className={`${styles.empty} muted`}>{t("rest.bodyNone")}</p>
      ) : (
        <div className={styles.readOnly}>
          <p className="muted">{t("rest.bodyNotEditable")}</p>
          <dl className={styles.fields}>
            {shown.map((field) => (
              <div key={field.id} className={styles.field}>
                <dt className={styles.fieldKey}>{field.key}</dt>
                <dd className={styles.fieldValue}>{field.file ?? field.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

export default BodyEditor;
