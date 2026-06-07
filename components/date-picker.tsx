"use client";

import { useEffect, useRef, useState } from "react";

import { Calendar } from "@/components/calendar";
import { Icon } from "@/components/icon";

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-06-05" → "5 Jun 2026". */
function prettyKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/**
 * The shadcn-style date field: a button showing the chosen date (or a
 * placeholder) that drops a {@link Calendar} in a popover. Controlled via
 * `value` / `onChange` in "YYYY-MM-DD" day-keys — a drop-in replacement for
 * `<input type="date">`. Closes on pick, outside-click, or Escape, mirroring
 * the shared {@link Select}.
 */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  id,
  placeholder = "Pick a date",
  block = false,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Inclusive earliest selectable day-key. */
  min?: string;
  /** Inclusive latest selectable day-key. */
  max?: string;
  /** Id for the trigger, so a `<label htmlFor>` can target it. */
  id?: string;
  placeholder?: string;
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

  return (
    <div
      className={`date-ctx${block ? " block" : ""}`}
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="date-field"
        data-empty={!value}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span className="cal-ico">
          <Icon name="calendar" />
        </span>
        <span className="lbl">{value ? prettyKey(value) : placeholder}</span>
        <span className="chev">
          <Icon name="chevdown" />
        </span>
      </button>

      {open && (
        <div className="cal-pop" role="dialog">
          <Calendar
            value={value || undefined}
            min={min}
            max={max}
            onSelect={(next) => {
              setOpen(false);
              onChange(next);
            }}
          />
        </div>
      )}
    </div>
  );
}
