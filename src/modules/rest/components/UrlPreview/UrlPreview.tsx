import Button from "../../../../components/Button";
import { useTranslation } from "../../../../i18n";
import styles from "./UrlPreview.module.css";

/** Splits the line into text and whatever is still in braces. The capturing group is what keeps
 *  the braces in the pieces rather than throwing them away. */
const PIECES = /(\{\{[A-Za-z0-9_.-]+\}\})/g;
const IS_VAR = /^\{\{[A-Za-z0-9_.-]+\}\}$/;

interface Props {
  /** The URL with its variables put in, and the value of a secret one shown as dots. */
  preview: string;
  /** Names the environment had nothing for, anywhere in the request — not only in the URL. */
  missing: string[];
  cyclic: boolean;
  envName: string;
  /** Adds every missing name to the chosen environment and opens the dialog on it. */
  onAddMissing: () => void;
}

/**
 * What the URL above will actually be, and why Send is off when it is.
 *
 * Only drawn when an environment is chosen: with None there is nothing to resolve, and the line
 * would repeat the box above it word for word.
 *
 * A secret's value is dots. The line is here to answer *did my variables resolve* — a missing name
 * in red, a filled one as text and a secret as dots all answer that, and none of them needs a token
 * to be readable across a shared screen with nothing to click to hide it. What is sent is the real
 * value; this is the same rule the history file follows in Phase 5.
 *
 * Only names in `missing` are painted. A `\{{literal}}` the user escaped on purpose comes through
 * here in braces too, and it is not a mistake.
 */
function UrlPreview({ preview, missing, cyclic, envName, onAddMissing }: Props) {
  const { t } = useTranslation();

  return (
    <div className={styles.preview}>
      <p className={styles.line}>
        <span className={styles.label}>{t("rest.previewLabel")}</span>
        <code className={styles.url}>
          {preview.split(PIECES).map((piece, i) =>
            IS_VAR.test(piece) && missing.includes(piece.slice(2, -2)) ? (
              <em key={i} className={styles.missing}>
                {piece}
              </em>
            ) : (
              <span key={i}>{piece}</span>
            ),
          )}
        </code>
      </p>

      {cyclic ? (
        <p className={styles.blocked} role="alert">
          {t("rest.varCycle", { env: envName })}
        </p>
      ) : (
        missing.length > 0 && (
          <p className={styles.blocked} role="alert">
            <span>{t("rest.missingVars", { names: missing.join(", "), env: envName })}</span>
            <Button size="small" onClick={onAddMissing}>
              {t("rest.addMissingVars", { env: envName })}
            </Button>
          </p>
        )
      )}
    </div>
  );
}

export default UrlPreview;
