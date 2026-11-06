import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { avatarColor, initials } from "../format";

export function useDismiss<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);
  return ref;
}

interface PopoverProps {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  placement?: "down" | "up";
  className?: string;
}

export function Popover({ trigger, children, align = "left", placement = "down", className = "" }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss<HTMLDivElement>(open, close);
  return (
    <div className="popover-anchor" ref={ref}>
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open ? (
        <div className={`popover ${align} ${placement} ${className}`} role="menu">
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

interface MenuItemProps {
  icon?: LucideIcon;
  label: ReactNode;
  hint?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  checked?: boolean;
  color?: string;
  disabled?: boolean;
}

export function MenuItem({ icon: Icon, label, hint, onClick, danger, checked, color, disabled }: MenuItemProps) {
  return (
    <button type="button" role="menuitem" className={`menu-item${danger ? " danger" : ""}`} onClick={onClick} disabled={disabled}>
      {color ? <span className="swatch" style={{ background: color }} /> : Icon ? <Icon size={16} strokeWidth={1.9} /> : <span className="menu-pad" />}
      <span className="menu-label">{label}</span>
      {hint ? <span className="menu-hint">{hint}</span> : null}
      {checked ? <Check size={15} className="menu-check" /> : null}
    </button>
  );
}

export function MenuDivider() {
  return <div className="menu-divider" role="separator" />;
}

export function MenuTitle({ children }: { children: ReactNode }) {
  return <div className="menu-title">{children}</div>;
}

interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  kbd?: string;
  size?: number;
  className?: string;
  disabled?: boolean;
  badge?: number;
}

export function IconButton({ icon: Icon, label, onClick, active, kbd, size = 18, className = "", disabled, badge }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? " active" : ""} ${className}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={kbd ? `${label} (${kbd})` : label}
      disabled={disabled}
    >
      <Icon size={size} strokeWidth={1.9} />
      {badge ? <span className="icon-badge">{badge > 99 ? "99+" : badge}</span> : null}
    </button>
  );
}

export function Avatar({ name, email, size = 36, ring }: { name: string; email: string; size?: number; ring?: string }) {
  const color = avatarColor(email || name);
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: `color-mix(in srgb, ${color} 16%, var(--surface))`,
        color,
        boxShadow: ring ? `0 0 0 2px var(--surface), 0 0 0 4px ${ring}` : undefined,
      }}
      aria-hidden
    >
      {initials(name, email)}
    </span>
  );
}

export function LabelChip({ name, color, onRemove }: { name: string; color: string; onRemove?: () => void }) {
  return (
    <span className="label-chip" style={{ ["--chip" as string]: color }}>
      <span className="label-dot" />
      {name}
      {onRemove ? (
        <button type="button" aria-label={`Remove ${name}`} onClick={onRemove}>
          <X size={12} />
        </button>
      ) : null}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  bare?: boolean;
}

export function Modal({ open, onClose, title, children, size = "md", className = "", bare }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className={`modal ${size} ${className}`} role="dialog" aria-modal onMouseDown={(event) => event.stopPropagation()}>
        {bare ? null : (
          <div className="modal-head">
            <h2>{title}</h2>
            <IconButton icon={X} label="Close" onClick={onClose} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? " on" : ""}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? "on" : ""} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon: Icon, title, body, children }: { icon: LucideIcon; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={26} strokeWidth={1.6} />
      </div>
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {children}
    </div>
  );
}
