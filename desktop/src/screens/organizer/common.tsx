import type { ReactNode } from "react";
import { Search, X } from "lucide-react";

export function OrgHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="org-head">
      <div className="org-title">
        <h1>{title}</h1>
        {sub ? <span className="list-total">{sub}</span> : null}
      </div>
      <div className="org-actions">{children}</div>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="org-search">
      <Search size={15} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} spellCheck={false} />
      {value ? (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search">
          <X size={14} />
        </button>
      ) : null}
    </label>
  );
}

export function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (color: string) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Color">
      {colors.map((color) => (
        <button
          key={color || "none"}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color || "No color"}
          className={`swatch-btn${value === color ? " on" : ""}${color ? "" : " none"}`}
          style={color ? { background: color } : undefined}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className={`round-check${checked ? " on" : ""}`} onClick={() => onChange(!checked)}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
        <path d="M3.5 8.5 6.5 11.5 12.5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
