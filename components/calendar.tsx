"use client";

import { useState } from "react";

import { Icon } from "@/components/icon";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Monday-first, matching the dashboard's Monday-start week buckets. */
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const MS_PER_DAY = 86_400_000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A "YYYY-MM-DD" UTC day-key — the calendar speaks the same string the rest of
 *  the app stores, so there's no Date round-trip to drift across timezones. */
function keyOf(y: number, m0: number, d: number): string {
  return `${y}-${pad(m0 + 1)}-${pad(d)}`;
}

/** Today as a UTC day-key (Ghana is UTC, so this is also the local day). */
function todayKey(): string {
  const now = new Date();
  return keyOf(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

interface Cell {
  key: string;
  day: number;
  inMonth: boolean;
}

/** The 42 cells (6 weeks) covering a month, with leading/trailing days from the
 *  neighbouring months so every row is full. UTC math — no DST seams. */
function monthGrid(year: number, month0: number): Cell[] {
  const firstWeekday = new Date(Date.UTC(year, month0, 1)).getUTCDay(); // 0 = Sun
  const lead = (firstWeekday + 6) % 7; // shift to Monday-first
  const start = Date.UTC(year, month0, 1 - lead);
  const cells: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start + i * MS_PER_DAY);
    cells.push({
      key: keyOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month0,
    });
  }
  return cells;
}

/**
 * A dependency-free, single-date month calendar — the grid behind {@link DatePicker}.
 * Works entirely in "YYYY-MM-DD" UTC day-keys (the app's date currency), so the
 * lexicographic order of the strings *is* chronological order, which is all the
 * `min` / `max` bounds need to disable out-of-range days. Monday-first to match
 * the dashboard's week buckets.
 */
export function Calendar({
  value,
  onSelect,
  min,
  max,
}: {
  /** Selected day-key, or undefined when nothing's picked yet. */
  value?: string;
  onSelect: (key: string) => void;
  /** Inclusive lower bound; earlier days are disabled. */
  min?: string;
  /** Inclusive upper bound; later days are disabled. */
  max?: string;
}) {
  const today = todayKey();
  const seed = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;
  const [view, setView] = useState(() => {
    const [y, m] = seed.split("-").map(Number);
    return { y, m0: m - 1 };
  });

  function shift(delta: number) {
    setView((v) => {
      const m = v.m0 + delta;
      return { y: v.y + Math.floor(m / 12), m0: ((m % 12) + 12) % 12 };
    });
  }

  const cells = monthGrid(view.y, view.m0);

  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="cal-nav" aria-label="Previous month" onClick={() => shift(-1)}>
          <Icon name="chevleft" />
        </button>
        <div className="cal-title">
          {MONTHS[view.m0]} {view.y}
        </div>
        <button type="button" className="cal-nav" aria-label="Next month" onClick={() => shift(1)}>
          <Icon name="chevright" />
        </button>
      </div>

      <div className="cal-grid cal-dow">
        {WEEKDAYS.map((w) => (
          <span key={w} className="cal-dow-cell">
            {w}
          </span>
        ))}
      </div>

      <div className="cal-grid" role="grid">
        {cells.map((c) => {
          const disabled = (min !== undefined && c.key < min) || (max !== undefined && c.key > max);
          const selected = c.key === value;
          const klass =
            "cal-day" +
            (selected ? " sel" : "") +
            (!c.inMonth ? " out" : "") +
            (c.key === today ? " today" : "");
          return (
            <button
              key={c.key}
              type="button"
              className={klass}
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onSelect(c.key)}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
