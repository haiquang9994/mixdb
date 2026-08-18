import Button from "../../../../components/Button";
import Select from "../../../../components/Select";
import { FormatIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { prettyJson } from "../../format";
import type { Body, RawLanguage } from "../../types";
import styles from "./BodyEditor.module.css";

interface Props {
  body: Body;
  onChange: (body: Body) => void;
}

/**
 * The Body tab.
 *
 * Phase 1 offers two kinds: none, and a raw string with a language that decides only what content
 * type is declared for it. Form, multipart and binary are Phase 3 — `Body` already has them, and
 * `buildRequest` already puts them on the wire, so this is the only file that grows.
 *
 * A plain `<textarea>` rather than the shared one, which grows to fit its text: this pane has a
 * height of its own and the box should fill it, not push the layout about as a body is pasted in.
 */
function BodyEditor({ body, onChange }: Props) {
  const { t } = useTranslation();

  const languages: { value: RawLanguage; label: string }[] = [
    { value: "json", label: t("rest.langJson") },
    { value: "xml", label: t("rest.langXml") },
    { value: "html", label: t("rest.langHtml") },
    { value: "text", label: t("rest.langText") },
  ];

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <Select<Body["kind"]>
          className={styles.kind}
          size="small"
          value={body.kind}
          ariaLabel={t("rest.bodyKind")}
          options={[
            { value: "none", label: t("rest.bodyNone") },
            { value: "raw", label: t("rest.bodyRaw") },
          ]}
          onChange={(kind) =>
            onChange(kind === "none" ? { kind: "none" } : { kind: "raw", language: "json", text: "" })
          }
        />
        {body.kind === "raw" && (
          <>
            <Select<RawLanguage>
              className={styles.language}
              size="small"
              value={body.language}
              ariaLabel={t("rest.bodyLanguage")}
              options={languages}
              onChange={(language) => onChange({ ...body, language })}
            />
            {body.language === "json" && (
              <Button size="small" onClick={() => onChange({ ...body, text: prettyJson(body.text) })}>
                <FormatIcon size="1em" />
              </Button>
            )}
          </>
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
