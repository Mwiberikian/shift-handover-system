import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import api from '../../api';
import { Button } from '../ui';
import { logAssistantEvent } from './useAssistant';

// Suggests a severity from the incident text once the user pauses typing.
// The user stays in control: "Use" applies it, and any other choice is logged
// as an override so the model's usefulness can be measured.
export default function SeverityHint({ title, description, current, onUse, recordId }) {
  const [hint, setHint] = useState(null);
  const lastKey = useRef('');
  useEffect(() => {
    const text = `${title}|${description}`;
    if (title.trim().length < 4) { setHint(null); return undefined; }
    const t = setTimeout(async () => {
      if (text === lastKey.current) return;
      lastKey.current = text;
      try {
        const res = await api.post('/assistant/severity', { title, description });
        const d = res?.data;
        if (d?.available) { setHint(d); logAssistantEvent('severity_suggested', recordId, { severity: d.severity }); } else setHint(null);
      } catch {
        setHint(null);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [title, description, recordId]);

  if (!hint) return null;
  const pct = Math.round(hint.confidence * 100);
  const same = hint.severity === current;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-200 bg-surface px-3 py-2 text-meta text-ink-700" role="status">
      <Sparkles aria-hidden className="size-4 text-ink-500" />
      <span>
        Similar past incidents were usually <strong className="text-fg">{hint.severity}</strong> ({pct}% sure
        {hint.top_terms?.length ? `, because of “${hint.top_terms.join('”, “')}”` : ''}).
      </span>
      {!same && (
        <Button
          size="sm"
          onClick={() => { onUse(hint.severity); logAssistantEvent('severity_accepted', recordId, { severity: hint.severity }); }}
        >
          Use {hint.severity}
        </Button>
      )}
    </div>
  );
}
