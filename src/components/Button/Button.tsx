import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export type ButtonSize = "small" | "normal" | "large";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
}

function Button({ size = "normal", type = "button", className, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[size]}${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
}

export default Button;
