import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api";
import { useMail } from "../state";
import type { Contact } from "../types";
import { Avatar } from "./ui";

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function split(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function bare(token: string): string {
  const match = /<([^>]+)>/.exec(token);
  return (match ? match[1] : token).trim();
}

export function RecipientInput({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (value: string) => void; autoFocus?: boolean }) {
  const { boot } = useMail();
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const tokens = split(value);

  useEffect(() => {
    const needle = text.trim();
    if (!needle || !boot) {
      setSuggestions([]);
      return;
    }
    let live = true;
    const handle = window.setTimeout(() => {
      api<{ contacts: Contact[] }>(`/api/contacts?session_id=${boot.active_session_id}&q=${encodeURIComponent(needle)}&limit=6`)
        .then((data) => {
          if (!live) return;
          const taken = new Set(tokens.map((item) => bare(item).toLowerCase()));
          setSuggestions(data.contacts.filter((item) => !taken.has(item.email.toLowerCase())));
          setCursor(0);
        })
        .catch(() => live && setSuggestions([]));
    }, 140);
    return () => {
      live = false;
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, boot?.active_session_id]);

  const commit = (raw: string) => {
    const parts = split(raw);
    if (!parts.length) return;
    onChange([...tokens, ...parts].join(", "));
    setText("");
    setSuggestions([]);
  };

  const choose = (contact: Contact) => {
    const token = contact.name ? `${contact.name.replace(/[<>,;"]/g, "")} <${contact.email}>` : contact.email;
    onChange([...tokens, token].join(", "));
    setText("");
    setSuggestions([]);
    input.current?.focus();
  };

  const remove = (index: number) => onChange(tokens.filter((_, i) => i !== index).join(", "));

  return (
    <div className="field-row recipients-field" onClick={() => input.current?.focus()}>
      <span className="field-label">{label}</span>
      <div className="chips-input">
        {tokens.map((token, index) => {
          const email = bare(token);
          const name = token.includes("<") ? token.split("<")[0].trim() : "";
          const valid = EMAIL.test(email);
          return (
            <span key={`${token}-${index}`} className={`recipient${valid ? "" : " invalid"}`} title={email}>
              {name || email}
              <button type="button" aria-label={`Remove ${email}`} onClick={() => remove(index)}>
                <X size={12} />
              </button>
            </span>
          );
        })}
        <input
          ref={input}
          autoFocus={autoFocus}
          value={text}
          aria-label={label}
          onChange={(event) => {
            const next = event.target.value;
            if (/[,;]$/.test(next)) commit(next);
            else setText(next);
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (/[,;\n]/.test(pasted)) {
              event.preventDefault();
              commit(pasted.replace(/\n/g, ","));
            }
          }}
          onKeyDown={(event) => {
            if (suggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              setCursor((current) => (event.key === "ArrowDown" ? Math.min(suggestions.length - 1, current + 1) : Math.max(0, current - 1)));
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              if (suggestions[cursor] && text.trim()) {
                event.preventDefault();
                choose(suggestions[cursor]);
              } else if (text.trim()) {
                if (event.key === "Enter") event.preventDefault();
                commit(text);
              }
            }
            if (event.key === "Backspace" && !text && tokens.length) remove(tokens.length - 1);
            if (event.key === "Escape" && suggestions.length) {
              event.stopPropagation();
              setSuggestions([]);
            }
          }}
          onBlur={() => window.setTimeout(() => text.trim() && commit(text), 120)}
        />
      </div>
      {suggestions.length ? (
        <div className="suggest">
          {suggestions.map((contact, index) => (
            <button
              key={contact.email}
              type="button"
              className={index === cursor ? "on" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setCursor(index)}
              onClick={() => choose(contact)}
            >
              <Avatar name={contact.name} email={contact.email} size={26} />
              <span>
                <strong>{contact.name || contact.email}</strong>
                {contact.name ? <small>{contact.email}</small> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
