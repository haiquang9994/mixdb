import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import styles from "./Select.module.css";

export interface SelectOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  /** Overrides what's shown for this option inside the open dropdown; defaults to `label`. */
  optionLabel?: React.ReactNode;
  /** What the search box matches against, for an option whose label isn't plain text. Without it
   * a node label falls back to the value, which is all the option really has to go on. */
  searchText?: string;
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
  /** Puts a search box at the head of the open dropdown and narrows the list to what it matches.
   * Worth it for lists long enough to scroll — databases, columns, operators. */
  searchable?: boolean;
  searchPlaceholder?: string;
}

const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;
/** Rough height of one row, used only to guess whether the menu fits below the trigger. */
const ROW_HEIGHT = 34;

/** Where the menu sits for the one render before it has been measured. It has to be taken out of
 * the flow from the very first frame: laid out at the end of `<body>` instead, it stretches the
 * page, and the scrollbar that appears is itself a resize — which closed the menu on its first
 * open, before it had a position to remember. */
const UNMEASURED: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  visibility: "hidden",
};

/** The text an option is searched by: what was given for it, else its label when that is plain
 * text, else the value — never a rendered node, which has nothing readable to match on. */
function optionText<T extends string | number>(opt: SelectOption<T>): string {
  if (opt.searchText !== undefined) return opt.searchText;
  if (typeof opt.label === "string" || typeof opt.label === "number") return String(opt.label);
  return String(opt.value);
}

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
  searchable = false,
  searchPlaceholder,
}: SelectProps<T>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>(UNMEASURED);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const skipScrollRef = useRef(false);

  const selected = options.find((o) => o.value === value);

  // Everything below indexes into the visible list, not the full one: with a query typed, the
  // keyboard and the mouse have to agree on what "the third option" means.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!searchable || needle === "") return options;
    return options.filter((o) => optionText(o).toLowerCase().includes(needle));
  }, [options, query, searchable]);
  const selectedIndex = visible.findIndex((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function close(e?: Event) {
      const target = e?.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    // Listening only from the next frame on. Opening the menu can scroll the page by itself —
    // measuring it, focusing the search box — and closing over the movement it just made would
    // shut the menu the moment it appeared.
    const frame = requestAnimationFrame(() => {
      window.addEventListener("resize", close);
      window.addEventListener("scroll", close, true);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  // Positioned off the full list, not the filtered one, so the menu doesn't hop around the
  // trigger as the query narrows it.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const rows = options.length + (searchable ? 1 : 0);
    const estimatedHeight = Math.min(rows * ROW_HEIGHT + 8, 256);
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
  }, [open, options.length, searchable]);

  // A query is a fresh start each time the menu opens — reopening on last time's filtered list
  // would hide options the trigger says nothing about.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open || !searchable) return;
    // `preventScroll` because the menu is already where it should be — letting the browser
    // scroll to reveal the box it just focused would only move the page under the trigger.
    searchRef.current?.focus({ preventScroll: true });
  }, [open, searchable]);

  useEffect(() => {
    if (open) {
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
  }, [open, query, selectedIndex]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    if (skipScrollRef.current) {
      skipScrollRef.current = false;
      return;
    }
    const list = listRef.current;
    const el = list?.children[activeIndex] as HTMLElement | undefined;
    if (!list || !el) return;
    // Scrolling the list by hand rather than with `scrollIntoView`, which walks up to the page
    // whenever the list itself has no room to give — and a page scroll closes the menu.
    const listRect = list.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (rect.top < listRect.top) list.scrollTop -= listRect.top - rect.top;
    else if (rect.bottom > listRect.bottom) list.scrollTop += rect.bottom - listRect.bottom;
  }, [open, activeIndex]);

  /** Closes and hands focus back to the trigger — with a search box the focus is inside the
   * portal, and leaving it on a menu that is gone would strand the keyboard on the body. */
  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function commit(index: number) {
    const opt = visible[index];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    close();
  }

  function moveActive(delta: number) {
    setActiveIndex((prev) => {
      let next = prev;
      for (let i = 0; i < visible.length; i++) {
        next = (next + delta + visible.length) % visible.length;
        if (!visible[next].disabled) break;
      }
      return next;
    });
  }

  /** `fromSearch` marks the keys pressed in the search box, where a space is text being typed
   * rather than the shortcut it is on the trigger. */
  function onKeyDown(e: React.KeyboardEvent, fromSearch = false) {
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
      case " ":
      case "Enter":
        // A space typed into the search box is part of what is being searched for, not the
        // trigger's shortcut for opening and choosing.
        if (e.key === " " && fromSearch && open) break;
        e.preventDefault();
        if (!open) setOpen(true);
        else commit(activeIndex);
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          close();
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
        {/* Sized above 1em because the shared icon grid leaves margin around the glyph it
            draws, and below the trigger's line box so the icon never sets its height. */}
        <ChevronDownIcon size="1.2em" className={styles.chevron} />
      </button>
      {open &&
        createPortal(
          <div className={styles.menu} ref={menuRef} style={menuStyle}>
            {searchable && (
              <input
                ref={searchRef}
                type="text"
                className={styles.search}
                value={query}
                placeholder={searchPlaceholder ?? t("select.searchPlaceholder")}
                aria-label={searchPlaceholder ?? t("select.searchPlaceholder")}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => onKeyDown(e, true)}
              />
            )}
            <ul className={styles.listbox} role="listbox" ref={listRef} tabIndex={-1}>
              {visible.map((opt, i) => (
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
              {visible.length === 0 && (
                <li className={styles.empty}>
                  {query.trim() === "" ? t("select.noOptions") : t("select.noMatches")}
                </li>
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default Select;
