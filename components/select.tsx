"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import { Icon, type IconName } from "@/components/icon";

export interface SelectOption {
  /** Submitted/identifying value. */
  value: string;
  /** Row text, and the trigger text when this option is selected. */
  label: string;
  /** Leading icon for the menu row. */
  icon?: IconName;
  /** Right-aligned secondary text (e.g. a shop count). */
  meta?: string;
  /** Draw a divider line beneath this row. */
  separatorAfter?: boolean;
}

/**
 * The shared "pick one" dropdown used everywhere a single choice is made — the
 * top-bar Shop switcher ({@link ShopSwitcher}) and the Shop / expiry-window
 * selects on Settings and Staff. It's a controlled button + popover styled with
 * the `.shop-switcher` / `.shop-menu` design classes, so every one of them looks
 * and behaves identically instead of falling back to the native OS `<select>`.
 *
 * Controlled via `value` / `onChange`. Pass `name` to drop a hidden input so it
 * still submits inside a plain `<form>`; pass `block` to fill a form field's
 * width (the bare trigger hugs its content, like the top bar). Closes on
 * outside-click or Escape, mirroring the original switcher.
 */
export function Select({
  value,
  onChange,
  options,
  name,
  id,
  groupLabel,
  triggerIcon,
  triggerClassName,
  placeholder = "Select…",
  disabled = false,
  block = false,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** When set, a hidden input carries the value for native form submission. */
  name?: string;
  /** Id for the trigger button, so a `<label htmlFor>` can target it. */
  id?: string;
  /** Optional uppercase heading at the top of the menu. */
  groupLabel?: string;
  /** Leading icon shown in the trigger button. */
  triggerIcon?: IconName;
  /** Extra class on the trigger (e.g. "all" to grey the icon). */
  triggerClassName?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Fill the container width (for form fields) instead of hugging content. */
  block?: boolean;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  const selected = options.find((o) => o.value === value) ?? null;

  function pick(next: string) {
    setOpen(false);
    if (next !== value) onChange(next);
  }

  return (
    <div
      className={`shop-ctx${block ? " block" : ""}`}
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`shop-switcher${triggerClassName ? ` ${triggerClassName}` : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {triggerIcon && (
          <span className="store">
            <Icon name={triggerIcon} />
          </span>
        )}
        <span className="lbl">{selected?.label ?? placeholder}</span>
        <span className="chev">
          <Icon name="chevdown" />
        </span>
      </button>

      {open && (
        <div className="shop-menu" role="listbox">
          {groupLabel && <div className="grp">{groupLabel}</div>}
          {options.map((opt) => (
            <Fragment key={opt.value}>
              <button
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={opt.value === value ? "sel" : ""}
                onClick={() => pick(opt.value)}
              >
                {opt.icon && <Icon name={opt.icon} />}
                <span>{opt.label}</span>
                {opt.meta && <span className="meta">{opt.meta}</span>}
              </button>
              {opt.separatorAfter && <div className="sep" />}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
