import type { InputHTMLAttributes } from "react";
import styles from "./Input.module.css";

export type InputSize = "small" | "normal" | "large";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
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
