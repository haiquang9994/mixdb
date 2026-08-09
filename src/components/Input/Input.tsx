import type { ComponentPropsWithRef } from "react";
import styles from "./Input.module.css";

export type InputSize = "small" | "normal" | "large";

/** Includes `ref`, which rides along in the rest props onto the underlying input — a caller that
 * needs to move focus here (the filter bar does) has no other way to reach the element. */
interface InputProps extends Omit<ComponentPropsWithRef<"input">, "size"> {
  size?: InputSize;
}

function Input({
  size = "normal",
  type = "text",
  autoComplete = "off",
  autoCorrect = "off",
  autoCapitalize = "off",
  spellCheck = false,
  className,
  ...rest
}: InputProps) {
  return (
    <input
      type={type}
      autoComplete={autoComplete}
      autoCorrect={autoCorrect}
      autoCapitalize={autoCapitalize}
      spellCheck={spellCheck}
      className={`${styles.input} ${styles[size]}${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
}

export default Input;
