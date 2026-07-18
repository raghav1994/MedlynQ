"use client";

import { useMemo, useRef, useState } from "react";

// Type-to-filter dropdown — used for State/District pickers backed by the
// real india-state-district dataset (36 states/UTs, real districts per
// state), so hospital addresses are validated against real Indian
// geography instead of free-typed strings that could be anything.
export default function SearchableSelect({
  label, value, onChange, options, placeholder, disabled, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    return base.slice(0, 50); // enough for scrolling, never dump 700+ districts unfiltered
  }, [query, options]);

  function selectOption(opt: string) {
    onChange(opt);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative" ref={containerRef}>
      <label className="text-[10px] uppercase font-semibold text-slate-400">{label}</label>
      <div className="relative mt-1">
        <input
          type="text"
          disabled={disabled}
          value={open ? query : value}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setQuery(""); setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={disabled ? "Pick a state first" : placeholder ?? `Search ${label.toLowerCase()}…`}
          className="w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {open && !disabled && filtered.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-slate-800 border border-slate-700 rounded shadow-lg">
            {filtered.map((opt) => (
              <li key={opt}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()} // keep focus so onBlur doesn't fire before click
                  onClick={() => selectOption(opt)}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-700 ${
                    opt === value ? "text-blue-400 font-semibold" : "text-slate-200"
                  }`}
                >
                  {opt}
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && !disabled && filtered.length === 0 && (
          <div className="absolute z-10 mt-1 w-full bg-slate-800 border border-slate-700 rounded shadow-lg px-3 py-1.5 text-xs text-slate-500">
            No match
          </div>
        )}
      </div>
      {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}
