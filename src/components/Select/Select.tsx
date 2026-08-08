import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../i18n";
import styles from "./Select.module.css";

export interface SelectOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  /** Overrides what's shown for this option inside the open dropdown; defaults to `label`. */
  optionLabel?: React.ReactNode;
  disabled?: boolean;
}

export type SelectSize = "small" | "normal" | "large";

interface SelectProps<T extends string | number> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: SelectSize;
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
  optionAlign?: "left" | "right" | "center";
}

const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

function Select<T extends string | number>({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  size = "normal",
  className,
  triggerClassName,
  ariaLabel,
  optionAlign = "left",
}: SelectProps<T>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const skipScrollRef = useRef(false);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function close(e?: Event) {
      const target = e?.target as Node | null;
      if (target && listRef.current?.contains(target)) return;
      setOpen(false);
    }
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const estimatedHeight = Math.min(options.length * 34 + 8, 256);
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - VIEWPORT_MARGIN;
    const openUp = estimatedHeight > spaceBelow && spaceAbove > spaceBelow;
    setMenuStyle({
      position: "fixed",
      left: rect.left,
      minWidth: rect.width,
      maxWidth: window.innerWidth - rect.left - VIEWPORT_MARGIN,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + MENU_GAP, maxHeight: spaceAbove }
        : { top: rect.bottom + MENU_GAP, maxHeight: spaceBelow }),
    });
  }, [open, options.length]);

  useEffect(() => {
    if (open) {
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    if (skipScrollRef.current) {
      skipScrollRef.current = false;
      return;
    }
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function commit(index: number) {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
  }

  function moveActive(delta: number) {
    setActiveIndex((prev) => {
      let next = prev;
      for (let i = 0; i < options.length; i++) {
        next = (next + delta + options.length) % options.length;
        if (!options[next].disabled) break;
      }
      return next;
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) setOpen(true);
        else moveActive(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) setOpen(true);
        else moveActive(-1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (!open) setOpen(true);
        else commit(activeIndex);
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div
      ref={rootRef}
      className={`${styles.select}${disabled ? ` ${styles.disabled}` : ""}${className ? ` ${className}` : ""}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${styles[size]}${triggerClassName ? ` ${triggerClassName}` : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className={styles.value} style={{ textAlign: optionAlign }}>
          {selected ? selected.label : placeholder ?? t("select.placeholder")}
        </span>
        <svg
          className={styles.chevron}
          width="10"
          height="6"
          viewBox="0 0 10 6"
          aria-hidden="true"
        >
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        createPortal(
          <ul className={styles.listbox} role="listbox" ref={listRef} tabIndex={-1} style={menuStyle}>
            {options.map((opt, i) => (
              <li
                key={String(opt.value)}
                role="option"
                aria-selected={opt.value === value}
                className={`${styles.option}${opt.value === value ? ` ${styles.optionSelected}` : ""}${
                  i === activeIndex ? ` ${styles.optionActive}` : ""
                }${opt.disabled ? ` ${styles.optionDisabled}` : ""}`}
                style={{ textAlign: optionAlign }}
                onMouseEnter={() => {
                  skipScrollRef.current = true;
                  setActiveIndex(i);
                }}
                onClick={() => commit(i)}
              >
                {opt.optionLabel ?? opt.label}
              </li>
            ))}
            {options.length === 0 && <li className={styles.empty}>{t("select.noOptions")}</li>}
          </ul>,
          document.body,
        )}
    </div>
  );
}

export default Select;
