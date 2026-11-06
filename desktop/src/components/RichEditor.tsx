import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  Bold,
  Eraser,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Palette,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDismiss } from "./ui";

export interface EditorHandle {
  focus: () => void;
  element: () => HTMLDivElement | null;
}

const COLORS = ["#111827", "#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#6b7280"];

function exec(command: string, value?: string) {
  document.execCommand(command, false, value);
}

interface Props {
  initialHtml: string;
  docKey: number;
  onChange: (html: string) => void;
  onFiles: (files: FileList) => void;
  placeholder?: string;
}

export const RichEditor = forwardRef<EditorHandle, Props>(function RichEditor({ initialHtml, docKey, onChange, onFiles, placeholder }, ref) {
  const area = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [url, setUrl] = useState("https://");
  const [, setTick] = useState(0);
  const linkRef = useDismiss<HTMLDivElement>(linkOpen, () => setLinkOpen(false));
  const colorRef = useDismiss<HTMLDivElement>(colorOpen, () => setColorOpen(false));
  const imageInput = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    element: () => area.current,
  }));

  const touched = useRef(false);

  // Only write innerHTML when a new document opens so typing never resets the caret.
  useEffect(() => {
    if (area.current) area.current.innerHTML = initialHtml;
    touched.current = false;
    saved.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // First time into a fresh message: start typing on the top line, above the signature and quote,
  // unless the click landed inside existing text.
  const placeCaretAtTop = () => {
    if (touched.current) return;
    touched.current = true;
    const el = area.current;
    const selection = window.getSelection();
    if (!el || !selection) return;
    const node = selection.anchorNode;
    const host = node ? (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement) : null;
    const inBoilerplate = Boolean(host?.closest("[data-signature], blockquote, .quote-head"));
    const inText = node && node.nodeType === Node.TEXT_NODE && el.contains(node) && (node.textContent ?? "").trim().length > 0;
    if (inText && !inBoilerplate) return;
    const first = el.firstElementChild ?? el;
    const range = document.createRange();
    range.setStart(first, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  useEffect(() => {
    const update = () => setTick((value) => value + 1);
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  const emit = () => onChange(area.current?.innerHTML ?? "");

  const save = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount && area.current?.contains(selection.anchorNode)) {
      saved.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const restore = () => {
    area.current?.focus();
    const selection = window.getSelection();
    if (saved.current && selection) {
      selection.removeAllRanges();
      selection.addRange(saved.current);
    }
  };

  const run = (command: string, value?: string) => {
    restore();
    exec(command, value);
    emit();
  };

  const state = (command: string) => {
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  };

  const tool = (icon: LucideIcon, label: string, command: string, value?: string) => {
    const Icon = icon;
    const on = ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"].includes(command) && state(command);
    return (
      <button
        type="button"
        className={`rt-btn${on ? " on" : ""}`}
        title={label}
        aria-label={label}
        onMouseDown={(event) => {
          event.preventDefault();
          save();
        }}
        onClick={() => run(command, value)}
      >
        <Icon size={15} strokeWidth={2} />
      </button>
    );
  };

  const insertImages = async (files: FileList | null) => {
    if (!files) return;
    for (const file of [...files]) {
      if (!file.type.startsWith("image/") || file.size > 3 * 1024 * 1024) continue;
      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      run("insertHTML", `<img src="${data}" alt="${file.name.replace(/"/g, "")}" style="max-width:100%">`);
    }
  };

  return (
    <div className="rich-editor">
      <div className="rt-toolbar" role="toolbar" aria-label="Formatting">
        {tool(Undo2, "Undo (Ctrl+Z)", "undo")}
        {tool(Redo2, "Redo (Ctrl+Y)", "redo")}
        <span className="rt-sep" />
        {tool(Bold, "Bold (Ctrl+B)", "bold")}
        {tool(Italic, "Italic (Ctrl+I)", "italic")}
        {tool(Underline, "Underline (Ctrl+U)", "underline")}
        {tool(Strikethrough, "Strikethrough", "strikeThrough")}
        <div className="popover-anchor" ref={colorRef}>
          <button
            type="button"
            className="rt-btn"
            title="Text color"
            aria-label="Text color"
            onMouseDown={(event) => {
              event.preventDefault();
              save();
            }}
            onClick={() => setColorOpen((value) => !value)}
          >
            <Palette size={15} />
          </button>
          {colorOpen ? (
            <div className="popover left up color-pop">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="color-dot"
                  style={{ background: color }}
                  aria-label={color}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    run("foreColor", color);
                    setColorOpen(false);
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
        <span className="rt-sep" />
        {tool(Heading2, "Heading", "formatBlock", "h3")}
        {tool(Quote, "Quote", "formatBlock", "blockquote")}
        {tool(List, "Bulleted list", "insertUnorderedList")}
        {tool(ListOrdered, "Numbered list", "insertOrderedList")}
        {tool(AlignLeft, "Align left", "justifyLeft")}
        {tool(AlignCenter, "Center", "justifyCenter")}
        <span className="rt-sep" />
        <div className="popover-anchor" ref={linkRef}>
          <button
            type="button"
            className="rt-btn"
            title="Insert link (Ctrl+K)"
            aria-label="Insert link"
            onMouseDown={(event) => {
              event.preventDefault();
              save();
            }}
            onClick={() => setLinkOpen((value) => !value)}
          >
            <Link2 size={15} />
          </button>
          {linkOpen ? (
            <form
              className="popover left up link-pop"
              onSubmit={(event) => {
                event.preventDefault();
                const target = url.trim();
                if (!/^(https?:|mailto:)/i.test(target)) return;
                const selection = saved.current?.toString();
                if (selection) run("createLink", target);
                else run("insertHTML", `<a href="${target.replace(/"/g, "%22")}">${target.replace(/</g, "&lt;")}</a>`);
                setLinkOpen(false);
                setUrl("https://");
              }}
            >
              <input autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" />
              <button type="submit" className="btn sm primary">
                Add
              </button>
            </form>
          ) : null}
        </div>
        <button
          type="button"
          className="rt-btn"
          title="Insert image"
          aria-label="Insert image"
          onMouseDown={(event) => {
            event.preventDefault();
            save();
          }}
          onClick={() => imageInput.current?.click()}
        >
          <ImagePlus size={15} />
        </button>
        <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(event) => void insertImages(event.target.files).then(() => (event.target.value = ""))} />
        {tool(Eraser, "Clear formatting", "removeFormat")}
      </div>
      <div
        ref={area}
        className="rt-area"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label="Message body"
        data-placeholder={placeholder}
        onInput={emit}
        onMouseUp={placeCaretAtTop}
        onFocus={() => window.setTimeout(() => document.activeElement === area.current && placeCaretAtTop(), 0)}
        onBlur={() => {
          save();
          emit();
        }}
        onKeyDown={(event) => {
          placeCaretAtTop();
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            event.stopPropagation();
            save();
            setLinkOpen(true);
          }
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length) {
            event.preventDefault();
            const images = [...event.dataTransfer.files].every((file) => file.type.startsWith("image/"));
            if (images && !event.shiftKey) void insertImages(event.dataTransfer.files);
            else onFiles(event.dataTransfer.files);
          }
        }}
      />
    </div>
  );
});
