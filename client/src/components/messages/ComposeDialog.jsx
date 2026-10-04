import { useEffect, useMemo, useState } from 'react';
import {
  Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions, Label, Field as HField,
} from '@headlessui/react';
import { Check, ChevronsUpDown, Send } from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { ROLE_LABEL, cx } from '../../lib/format';
import useAction from '../../lib/useAction';
import {
  Button, Input, Modal, SegmentedPicker, Select, Textarea,
} from '../ui';

const BROADCASTERS = ['supervisor', 'admin'];
const MAX = 2000;

// Searchable person picker (Headless UI Combobox: type to filter, arrows to
// move, Enter to choose, Escape to close).
function PersonPicker({ people, value, onChange }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q
    ? people.filter((p) => [p.full_name, p.department_name, ROLE_LABEL[p.role]].some((v) => v?.toLowerCase().includes(q)))
    : people;
  return (
    <HField className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium text-ink-800">
        Recipient<span aria-hidden className="ml-0.5 text-accent-fg">*</span>
      </Label>
      <Combobox value={value} onChange={onChange} onClose={() => setQuery('')} by="user_id">
        <div className="relative">
          <ComboboxInput
            className="block h-9 w-full rounded-lg border border-ink-300 bg-surface px-3 pr-9 text-body text-fg shadow-sm placeholder:text-ink-500 hover:border-ink-400 focus:border-brand-red-dark focus:ring-2 focus:ring-brand-red/25 focus:outline-none"
            displayValue={(p) => p?.full_name ?? ''}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, role or department…"
            autoComplete="off"
          />
          <ComboboxButton className="absolute inset-y-0 right-0 grid w-9 place-items-center text-ink-500" aria-label="Show people">
            <ChevronsUpDown aria-hidden className="size-4" />
          </ComboboxButton>
        </div>
        <ComboboxOptions
          anchor={{ to: 'bottom start', gap: 4 }}
          transition
          className="z-[60] max-h-64 w-(--input-width) overflow-y-auto rounded-xl border border-ink-200 bg-surface p-1 shadow-pop transition duration-100 empty:invisible data-closed:opacity-0"
        >
          {filtered.length === 0 && <div className="px-3 py-2 text-ink-600">No one matches “{query}”.</div>}
          {filtered.map((p) => (
            <ComboboxOption
              key={p.user_id}
              value={p}
              className="group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 data-focus:bg-ink-100"
            >
              <Check aria-hidden className="invisible size-4 shrink-0 text-accent-fg group-data-selected:visible" />
              <span className="min-w-0">
                <span className="block truncate font-medium text-fg">{p.full_name}</span>
                <span className="block truncate text-meta text-ink-600">{ROLE_LABEL[p.role]}{p.department_name && ` · ${p.department_name}`}</span>
              </span>
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      </Combobox>
    </HField>
  );
}

// `initial` may preset { type: 'user', person: { user_id, full_name }, subject } for replies.
export default function ComposeDialog({ open, onClose, onSent, initial }) {
  const { claims, profile } = useAuth();
  const [people, setPeople] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [type, setType] = useState('user');
  const [person, setPerson] = useState(null);
  const [departmentId, setDepartmentId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [run, busy] = useAction();

  const canBroadcastAnywhere = BROADCASTERS.includes(claims.role);
  const myDept = claims.department_id;

  useEffect(() => {
    if (!open) return;
    setType(initial?.type ?? 'user');
    setPerson(initial?.person ?? null);
    setSubject(initial?.subject ?? '');
    setDepartmentId('');
    setBody('');
    api.get('/directory').then((r) => setPeople(r.data.filter((p) => p.user_id !== claims.user_id))).catch(() => {});
    if (canBroadcastAnywhere) api.get('/directory/departments').then((r) => setDepartments(r.data)).catch(() => {});
  }, [open, initial, claims.user_id, canBroadcastAnywhere]);

  // People list must contain the preset reply recipient for the Combobox to show it.
  const personValue = useMemo(() => (person ? people.find((p) => p.user_id === person.user_id) ?? person : null), [person, people]);

  const options = [
    { value: 'user', label: 'Person', tone: 'gray' },
    ...(myDept ? [{ value: 'mydept', label: 'My department', tone: 'gray' }] : []),
    ...(canBroadcastAnywhere ? [{ value: 'dept', label: 'Any department', tone: 'gray' }, { value: 'org', label: 'Everyone', tone: 'gray' }] : []),
  ];

  const ready = body.trim().length > 0 && body.length <= MAX
    && (type !== 'user' || personValue) && (type !== 'dept' || departmentId);

  const send = async () => {
    const payload = { subject: subject.trim() || undefined, body };
    if (type === 'user') Object.assign(payload, { recipient_type: 'user', recipient_user_id: personValue.user_id });
    if (type === 'mydept') Object.assign(payload, { recipient_type: 'department', recipient_department_id: myDept });
    if (type === 'dept') Object.assign(payload, { recipient_type: 'department', recipient_department_id: departmentId });
    if (type === 'org') payload.recipient_type = 'organisation';
    const ok = await run(() => api.post('/messages', payload), 'Message sent');
    if (ok) { onSent?.(); onClose(); }
  };

  const audience = {
    mydept: `Everyone in ${profile?.department_name ?? 'your department'} will see this.`,
    org: 'Every user in the organisation will see this.',
  }[type];

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="lg"
      title={initial?.person ? `Reply to ${initial.person.full_name}` : 'New message'}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon={Send} loading={busy} disabled={!ready} onClick={send}>Send</Button>
        </>
      )}
    >
      <div className="grid gap-4">
        {options.length > 1 && <SegmentedPicker label="Send to" value={type} onChange={setType} options={options} />}
        {type === 'user' && <PersonPicker people={people} value={personValue} onChange={setPerson} />}
        {type === 'dept' && (
          <Select
            label="Department"
            required
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            placeholder="Select a department…"
            options={departments.map((d) => ({ value: d.department_id, label: d.name }))}
          />
        )}
        {audience && <p className={cx('rounded-lg bg-ink-100 px-3 py-2 text-meta text-ink-700')}>{audience}</p>}
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} placeholder="Optional" />
        <Textarea
          label="Message"
          required
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX}
          hint={`${body.length} / ${MAX} characters. Messages can't be edited or deleted once sent.`}
        />
      </div>
    </Modal>
  );
}
