import { Label, Radio, RadioGroup } from '@headlessui/react';
import { cx } from '../../lib/format';

const CHECKED = {
  gray: 'data-checked:bg-status-gray-soft data-checked:text-status-gray data-checked:ring-status-gray',
  amber: 'data-checked:bg-status-amber-soft data-checked:text-status-amber data-checked:ring-status-amber',
  red: 'data-checked:bg-status-red-soft data-checked:text-status-red data-checked:ring-status-red',
  'red-solid': 'data-checked:bg-brand-red-dark data-checked:text-white data-checked:ring-brand-red-dark',
};

// Radio group rendered as a row of pills coloured like StatusBadge.
// Arrow keys move between options. options: [{ value, label, tone }]
export default function SegmentedPicker({ label, value, onChange, options, className }) {
  return (
    <RadioGroup value={value} onChange={onChange} className={cx('flex flex-col gap-1.5', className)}>
      <Label className="text-sm font-medium text-zinc-800">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Radio
            key={o.value}
            value={o.value}
            className={cx(
              'cursor-pointer rounded-full bg-white px-3 py-1 text-meta font-medium text-zinc-600 ring-1 ring-zinc-300 transition-colors ring-inset',
              'hover:bg-zinc-50 data-checked:ring-2 data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-brand-red',
              CHECKED[o.tone ?? 'gray'],
            )}
          >
            {o.label}
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}

export const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low', tone: 'gray' },
  { value: 'medium', label: 'Medium', tone: 'amber' },
  { value: 'high', label: 'High', tone: 'red' },
];

export const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low', tone: 'gray' },
  { value: 'medium', label: 'Medium', tone: 'amber' },
  { value: 'high', label: 'High', tone: 'red' },
  { value: 'critical', label: 'Critical', tone: 'red-solid' },
];
