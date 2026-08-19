import Button from "../../../../components/Button";
import Select from "../../../../components/Select";
import { FormatIcon } from "../../../../icons";
import { useTranslation, type TranslationKey } from "../../../../i18n";
import { BODY_CHOICES, bodyChoice, convertBody, type BodyChoice } from "../../bodyKind";
import { prettyJson } from "../../format";
import type { Body, MultipartField } from "../../types";
import KeyValueTable from "../KeyValueTable";
import MultipartTable from "../MultipartTable";
import styles from "./BodyEditor.module.css";

interface Props {
  body: Body;
  onChange: (body: Body) => void;
}

const LABELS: Record<BodyChoice, TranslationKey> = {
  none: "rest.bodyNone",
  json: "rest.langJson",
  xml: "rest.langXml",
  yaml: "rest.langYaml",
  text: "rest.langText",
  form: "rest.bodyForm",
  multipart: "rest.bodyMultipart",
  binary: "rest.bodyBinary",
};

/** The kinds this pane can make and change. It grows once per phase-3 task; when it holds all of
 *  `BODY_CHOICES`, both it and the read-only view below go. */
const EDITABLE: BodyChoice[] = ["none", "json", "xml", "yaml", "text", "form", "multipart"];

/**
 * The rows to show for a body this pane cannot edit, or null when it can.
 *
 * Read as multipart fields throughout, since a plain form field is simply one without a file, and a
 * binary body is one file with no name of its own.
 */
function readOnlyFields(body: Body): MultipartField[] | null {
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

  const choice = bodyChoice(body);
  const shown = readOnlyFields(body);
  const options = BODY_CHOICES.map((value) => ({
    value,
    label: t(LABELS[value]),
    /* A kind with no editor yet is listed so the picker is not silently wrong about what is being
       sent, and cannot be chosen — there would be nothing to put in it. */
    disabled: !EDITABLE.includes(value),
  }));

  /** Changing the picker is a change of body, and `convertBody` says what survives it: text keeps
   *  its text, a form and a multipart body keep each other's rows, and nothing else carries. */
  function pick(next: BodyChoice) {
    onChange(convertBody(body, next));
  }

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <Select<BodyChoice>
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
      ) : body.kind === "form" ? (
        <KeyValueTable
          rows={body.fields}
          onChange={(fields) => onChange({ kind: "form", fields })}
        />
      ) : body.kind === "multipart" ? (
        <MultipartTable
          rows={body.fields}
          onChange={(fields) => onChange({ kind: "multipart", fields })}
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
