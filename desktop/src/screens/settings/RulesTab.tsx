import { useEffect, useState } from "react";
import { Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { api, post } from "../../api";
import { useMail } from "../../state";
import type { Rule, RuleAction, RuleCondition } from "../../types";
import { Toggle } from "../../components/ui";

const FIELDS: { value: RuleCondition["field"]; label: string }[] = [
  { value: "from", label: "From" },
  { value: "to", label: "To or Cc" },
  { value: "subject", label: "Subject" },
  { value: "body", label: "Body" },
  { value: "any", label: "Anywhere" },
  { value: "account", label: "Received by" },
];

const OPS: { value: RuleCondition["op"]; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "doesn't contain" },
  { value: "equals", label: "is" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
];

const ACTIONS: { value: string; label: string }[] = [
  { value: "label", label: "Apply label" },
  { value: "read", label: "Mark as read" },
  { value: "flag", label: "Flag it" },
  { value: "archive", label: "Archive (skip inbox)" },
  { value: "spam", label: "Move to Spam" },
  { value: "trash", label: "Delete" },
];

interface Draft {
  id: number | null;
  name: string;
  enabled: boolean;
  match: "all" | "any";
  conditions: RuleCondition[];
  actions: RuleAction[];
  stop: boolean;
}

const blank = (): Draft => ({
  id: null,
  name: "",
  enabled: true,
  match: "all",
  conditions: [{ field: "from", op: "contains", value: "" }],
  actions: [{ type: "archive" }],
  stop: false,
});

function describe(rule: Rule, labelName: (id?: number) => string): string {
  const joiner = rule.match === "all" ? " and " : " or ";
  const when = rule.conditions
    .map((item) => `${FIELDS.find((f) => f.value === item.field)?.label.toLowerCase()} ${OPS.find((o) => o.value === item.op)?.label} “${item.value}”`)
    .join(joiner);
  const then = rule.actions
    .map((item) => (item.type === "label" ? `label ${labelName(item.label_id)}` : ACTIONS.find((a) => a.value === item.type)?.label.toLowerCase() ?? item.type))
    .join(", ");
  return `If ${when} → ${then}`;
}

export function RulesTab() {
  const { boot, sessionLabels, activeSession, toast, run, reload } = useMail();
  const [rules, setRules] = useState<Rule[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);

  const load = () => {
    if (!boot) return;
    api<{ rules: Rule[] }>(`/api/rules?session_id=${boot.active_session_id}`)
      .then((data) => setRules(data.rules))
      .catch(() => setRules([]));
  };
  useEffect(load, [boot?.active_session_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!boot) return null;
  const labelName = (id?: number) => sessionLabels.find((item) => item.id === id)?.name ?? "(deleted label)";

  const save = (draft: Draft) =>
    run(async () => {
      const body = { session_id: boot.active_session_id, name: draft.name || "Untitled rule", enabled: draft.enabled, match: draft.match, conditions: draft.conditions, actions: draft.actions, stop: draft.stop };
      if (draft.id) await api(`/api/rules/${draft.id}`, { method: "PUT", body: JSON.stringify(body) });
      else await post("/api/rules", body);
      setEditing(null);
      toast("Rule saved — it runs on new mail as it arrives", { tone: "success" });
      load();
    });

  return (
    <>
      <section className="set-section">
        <div className="set-section-head">
          <h3>Rules for {activeSession?.name}</h3>
          <p>Like Outlook rules and Thunderbird filters: rules run on every new inbox message across the session's accounts, top to bottom.</p>
        </div>
        <div className="rule-actions">
          <button type="button" className="btn primary sm" onClick={() => setEditing(blank())}>
            <Plus size={14} /> New rule
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={!rules.length}
            onClick={() =>
              void run(async () => {
                const result = await post<{ matched: number }>(`/api/rules/run?session_id=${boot.active_session_id}`);
                toast(`Rules applied to ${result.matched} inbox message${result.matched === 1 ? "" : "s"}`, { tone: "success" });
                await reload();
              })
            }
          >
            <Play size={14} /> Run on inbox now
          </button>
        </div>
        {editing ? <RuleEditor draft={editing} onChange={setEditing} onCancel={() => setEditing(null)} onSave={() => void save(editing)} /> : null}
        {!rules.length && !editing ? <p className="set-hint">No rules yet. Try “From contains newsletter → Archive”.</p> : null}
        {rules.map((rule) => (
          <div key={rule.id} className={`rule-card${rule.enabled ? "" : " off"}`}>
            <Toggle label="Enabled" checked={rule.enabled} onChange={(enabled) => void save({ ...rule, enabled })} />
            <div className="grow">
              <div className="rule-name">{rule.name}</div>
              <div className="rule-desc">{describe(rule, labelName)}{rule.stop ? " · then stop" : ""}</div>
            </div>
            <button type="button" className="btn sm" onClick={() => setEditing({ ...rule })}>
              <Pencil size={14} />
            </button>
            <button type="button" className="btn sm danger-ghost" onClick={() => void run(async () => { await api(`/api/rules/${rule.id}`, { method: "DELETE" }); load(); })}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </section>
    </>
  );
}

function RuleEditor({ draft, onChange, onCancel, onSave }: { draft: Draft; onChange: (draft: Draft) => void; onCancel: () => void; onSave: () => void }) {
  const { sessionLabels } = useMail();
  const setCondition = (index: number, patch: Partial<RuleCondition>) => onChange({ ...draft, conditions: draft.conditions.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  const setAction = (index: number, patch: Partial<RuleAction>) => onChange({ ...draft, actions: draft.actions.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  return (
    <div className="rule-editor">
      <label className="field">
        <span>Rule name</span>
        <input autoFocus value={draft.name} placeholder="e.g. Newsletters out of the inbox" onChange={(event) => onChange({ ...draft, name: event.target.value })} />
      </label>
      <div className="rule-block">
        <div className="rule-block-head">
          When a new message arrives and
          <select className="select sm" value={draft.match} onChange={(event) => onChange({ ...draft, match: event.target.value as "all" | "any" })}>
            <option value="all">all</option>
            <option value="any">any</option>
          </select>
          of these are true:
        </div>
        {draft.conditions.map((condition, index) => (
          <div key={index} className="rule-line">
            <select className="select sm" value={condition.field} onChange={(event) => setCondition(index, { field: event.target.value as RuleCondition["field"] })}>
              {FIELDS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <select className="select sm" value={condition.op} onChange={(event) => setCondition(index, { op: event.target.value as RuleCondition["op"] })}>
              {OPS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <input className="grow" value={condition.value} placeholder="text" onChange={(event) => setCondition(index, { value: event.target.value })} />
            <button type="button" className="icon-btn" aria-label="Remove condition" disabled={draft.conditions.length === 1} onClick={() => onChange({ ...draft, conditions: draft.conditions.filter((_, i) => i !== index) })}>
              <X size={15} />
            </button>
          </div>
        ))}
        <button type="button" className="link-btn" onClick={() => onChange({ ...draft, conditions: [...draft.conditions, { field: "subject", op: "contains", value: "" }] })}>
          <Plus size={14} /> Add condition
        </button>
      </div>
      <div className="rule-block">
        <div className="rule-block-head">Do this:</div>
        {draft.actions.map((action, index) => (
          <div key={index} className="rule-line">
            <select className="select sm" value={action.type} onChange={(event) => setAction(index, { type: event.target.value as RuleAction["type"], label_id: event.target.value === "label" ? sessionLabels[0]?.id : undefined })}>
              {ACTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            {action.type === "label" ? (
              <select className="select sm" value={action.label_id ?? ""} onChange={(event) => setAction(index, { label_id: Number(event.target.value) })}>
                {sessionLabels.length ? null : <option value="">Create a label first</option>}
                {sessionLabels.map((label) => (
                  <option key={label.id} value={label.id}>{label.name}</option>
                ))}
              </select>
            ) : null}
            <span className="grow" />
            <button type="button" className="icon-btn" aria-label="Remove action" disabled={draft.actions.length === 1} onClick={() => onChange({ ...draft, actions: draft.actions.filter((_, i) => i !== index) })}>
              <X size={15} />
            </button>
          </div>
        ))}
        <button type="button" className="link-btn" onClick={() => onChange({ ...draft, actions: [...draft.actions, { type: "read" }] })}>
          <Plus size={14} /> Add action
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={draft.stop} onChange={(event) => onChange({ ...draft, stop: event.target.checked })} /> Stop processing more rules
      </label>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn primary" onClick={onSave} disabled={draft.conditions.some((item) => !item.value.trim())}>
          Save rule
        </button>
      </div>
    </div>
  );
}
