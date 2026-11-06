import { useState } from "react";
import { AlarmClock, AlarmClockOff, Archive, CalendarClock, FolderInput, Inbox, Plus, ShieldAlert, Tag, Trash2 } from "lucide-react";
import { timePresets, toLocalInput } from "../format";
import { useMail } from "../state";
import { IconButton, MenuDivider, MenuItem, MenuTitle, Popover } from "./ui";

export function TimePicker({ title, onPick, onClose, extra }: { title: string; onPick: (when: Date) => void; onClose: () => void; extra?: React.ReactNode }) {
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState(toLocalInput(new Date(Date.now() + 24 * 3600 * 1000)));
  return (
    <>
      <MenuTitle>{title}</MenuTitle>
      {timePresets().map((item) => (
        <MenuItem
          key={item.label}
          label={item.label}
          hint={item.hint}
          onClick={() => {
            onClose();
            onPick(item.when);
          }}
        />
      ))}
      <MenuDivider />
      {custom ? (
        <form
          className="menu-form"
          onSubmit={(event) => {
            event.preventDefault();
            const when = new Date(value);
            if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) return;
            onClose();
            onPick(when);
          }}
        >
          <input type="datetime-local" value={value} min={toLocalInput(new Date())} onChange={(event) => setValue(event.target.value)} autoFocus />
          <button type="submit" className="btn sm primary">
            Set
          </button>
        </form>
      ) : (
        <MenuItem icon={CalendarClock} label="Pick date & time" onClick={() => setCustom(true)} />
      )}
      {extra}
    </>
  );
}

export function SnoozeMenu({ ids, snoozed }: { ids?: number[]; snoozed?: boolean }) {
  const { snoozeMessages } = useMail();
  return (
    <Popover
      align="right"
      trigger={({ toggle, open }) => <IconButton icon={AlarmClock} label="Snooze" kbd="B" onClick={toggle} active={open} size={17} />}
    >
      {(close) => (
        <TimePicker
          title="Snooze until"
          onClose={close}
          onPick={(when) => void snoozeMessages(when, ids)}
          extra={
            snoozed ? (
              <MenuItem
                icon={AlarmClockOff}
                label="Unsnooze now"
                onClick={() => {
                  close();
                  void snoozeMessages(null, ids);
                }}
              />
            ) : null
          }
        />
      )}
    </Popover>
  );
}

export function LabelMenu({ ids, current = [] }: { ids?: number[]; current?: number[] }) {
  const { sessionLabels, labelMessages, createLabel } = useMail();
  const [filter, setFilter] = useState("");
  const visible = sessionLabels.filter((label) => label.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const exact = sessionLabels.some((label) => label.name.toLowerCase() === filter.trim().toLowerCase());
  return (
    <Popover align="right" trigger={({ toggle, open }) => <IconButton icon={Tag} label="Label" kbd="L" onClick={toggle} active={open} size={17} />}>
      {(close) => (
        <>
          <MenuTitle>Label as</MenuTitle>
          <div className="menu-form">
            <input
              autoFocus
              placeholder="Find or create a label"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={async (event) => {
                if (event.key === "Enter" && filter.trim() && !exact) {
                  const made = await createLabel(filter.trim());
                  if (made) void labelMessages(made.id, true, ids);
                  setFilter("");
                  close();
                }
              }}
            />
          </div>
          <div className="menu-scroll">
            {visible.map((label) => {
              const has = current.includes(label.id);
              return (
                <MenuItem
                  key={label.id}
                  color={label.color}
                  label={label.name}
                  checked={has}
                  onClick={() => {
                    void labelMessages(label.id, !has, ids);
                    close();
                  }}
                />
              );
            })}
          </div>
          {filter.trim() && !exact ? (
            <MenuItem
              icon={Plus}
              label={`Create “${filter.trim()}”`}
              onClick={async () => {
                const made = await createLabel(filter.trim());
                if (made) void labelMessages(made.id, true, ids);
                setFilter("");
                close();
              }}
            />
          ) : null}
          {!sessionLabels.length && !filter ? <p className="menu-note">Type a name to create your first label.</p> : null}
        </>
      )}
    </Popover>
  );
}

export function MoveMenu({ ids, role }: { ids?: number[]; role: string }) {
  const { act } = useMail();
  return (
    <Popover align="right" trigger={({ toggle, open }) => <IconButton icon={FolderInput} label="Move to" kbd="V" onClick={toggle} active={open} size={17} />}>
      {(close) => (
        <>
          <MenuTitle>Move to</MenuTitle>
          {role !== "inbox" ? <MenuItem icon={Inbox} label="Inbox" onClick={() => { close(); void act(role === "spam" ? "not_spam" : "inbox", ids); }} /> : null}
          {role !== "archive" ? <MenuItem icon={Archive} label="Archive" onClick={() => { close(); void act("archive", ids); }} /> : null}
          {role !== "spam" ? <MenuItem icon={ShieldAlert} label="Spam" onClick={() => { close(); void act("spam", ids); }} /> : null}
          {role !== "trash" ? <MenuItem icon={Trash2} label="Trash" onClick={() => { close(); void act("trash", ids); }} /> : null}
        </>
      )}
    </Popover>
  );
}
