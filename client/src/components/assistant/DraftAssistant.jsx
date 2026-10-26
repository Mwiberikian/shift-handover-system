import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Lightbulb, Plus, Repeat2, Sparkles, X,
} from 'lucide-react';
import api from '../../api';
import { Badge, Button, Card } from '../ui';
import { cx, formatEAT } from '../../lib/format';
import { toastError } from '../../lib/toast';
import { logAssistantEvent, useAssistantData } from './useAssistant';

const LEVEL_TONE = { high: 'red', medium: 'amber', low: 'gray' };
const flagKey = (f) => `${f.code}:${f.ref?.kind ?? ''}:${f.ref?.index ?? ''}`;

function Section({ icon: Icon, title, children }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-meta font-semibold uppercase tracking-wide text-ink-600">
        <Icon aria-hidden className="size-4" />{title}
      </h3>
      {children}
    </section>
  );
}

// Advisory panel for a draft: quality flags, recurring issues, suggested tasks.
// Nothing here blocks submission or changes the record without a click.
// `version` changes whenever the saved draft does, which re-runs the checks.
export default function DraftAssistant({ record, version, reload }) {
  const id = record.record_id;
  const check = useAssistantData(`/assistant/handovers/${id}/check`, [version]);
  const recurring = useAssistantData(`/assistant/handovers/${id}/recurring`, [version]);
  const suggestions = useAssistantData(`/assistant/handovers/${id}/suggestions`, [version]);
  const [dismissedFlags, setDismissedFlags] = useState(() => new Set());
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => new Set());
  const [adding, setAdding] = useState(null);
  const shown = useRef(false);

  const flags = (check.data?.flags ?? []).filter((f) => !dismissedFlags.has(flagKey(f)));
  const recs = recurring.data?.recurring ?? [];
  const sugg = (suggestions.data?.suggestions ?? []).filter((s) => !dismissedSuggestions.has(s.id));

  useEffect(() => {
    if (shown.current || !check.data) return;
    shown.current = true;
    if (check.data.flags?.length) logAssistantEvent('flags_shown', id, { n: check.data.flags.length });
  }, [check.data, id]);

  // Nothing at all to say: stay out of the way.
  if (check.error && recurring.error && suggestions.error) return null;
  if (check.loading && !check.data) return null;
  if (!flags.length && !recs.length && !sugg.length) {
    return (
      <Card title="Assistant" icon={Sparkles} subtitle="Advisory only. It never blocks submission.">
        <p className="text-ink-700">No problems found in the saved draft.</p>
      </Card>
    );
  }

  const dismissFlag = (f) => {
    setDismissedFlags((s) => new Set(s).add(flagKey(f)));
    logAssistantEvent('flag_dismissed', id, { code: f.code });
  };
  const dismissSuggestion = (s) => {
    setDismissedSuggestions((d) => new Set(d).add(s.id));
    logAssistantEvent('suggestion_dismissed', id, { id: s.id });
  };
  const accept = async (s) => {
    setAdding(s.id);
    try {
      await api.post(`/handovers/${id}/tasks`, { description: s.text, priority: s.priority });
      logAssistantEvent('suggestion_accepted', id, { id: s.id });
      await reload();
    } catch (err) {
      toastError(err);
    } finally {
      setAdding(null);
    }
  };

  return (
    <Card title="Assistant" icon={Sparkles} subtitle="Advisory only. Based on the last saved draft; it never blocks submission.">
      <div className="space-y-5">
        {flags.length > 0 && (
          <Section icon={AlertTriangle} title="Worth a second look">
            <ul className="space-y-2">
              {flags.map((f) => (
                <li key={flagKey(f)} className="flex items-start gap-2 rounded-lg bg-ink-50 px-3 py-2">
                  <Badge tone={LEVEL_TONE[f.level] ?? 'gray'}>{f.level}</Badge>
                  <p className="min-w-0 flex-1 text-ink-800">{f.message}</p>
                  <button type="button" onClick={() => dismissFlag(f)} aria-label={`Dismiss: ${f.message}`} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100">
                    <X aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {recs.length > 0 && (
          <Section icon={Repeat2} title="Seen before">
            <ul className="space-y-2">
              {recs.map((r) => (
                <li key={r.id} className="rounded-lg bg-ink-50 px-3 py-2 text-ink-800">
                  <p>
                    <strong className="text-fg">“{r.text}”</strong>
                    {' '}looks like {r.matches.length} earlier item{r.matches.length === 1 ? '' : 's'} from the last 30 days.
                  </p>
                  <p className="mt-0.5 text-meta text-ink-600">
                    Latest: {formatEAT(r.matches[0].shift_start, 'date')}
                    {r.matches[0].text ? ` · “${r.matches[0].text}”` : ' · from another author'}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {sugg.length > 0 && (
          <Section icon={Lightbulb} title="Tasks you often hand over">
            <ul className="space-y-2">
              {sugg.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-50 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-ink-800">{s.text}</p>
                    <p className={cx('text-meta text-ink-600')}>In {s.support} of your last {s.of} handovers · {s.priority} priority</p>
                  </div>
                  <Button size="sm" icon={Plus} loading={adding === s.id} onClick={() => accept(s)} aria-label={`Add task: ${s.text}`}>Add</Button>
                  <Button size="sm" variant="ghost" onClick={() => dismissSuggestion(s)} aria-label={`Not now: ${s.text}`}>Not now</Button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </Card>
  );
}
