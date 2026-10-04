import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ChevronDown, ClipboardList, Handshake, Keyboard, LifeBuoy, Mail, Phone, ShieldCheck, UserCog,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import PublicHeader from '../components/shell/PublicHeader';
import { Callout, Card } from '../components/ui';
import { ROLE_LABEL, cx } from '../lib/format';
import { SUPPORT, telHref } from '../lib/support';

// Role guides describe what the app actually does; keep them in step with the UI.
const ROLE_GUIDES = [
  {
    role: 'outgoing_staff',
    icon: ClipboardList,
    title: 'Create and submit a handover',
    steps: [
      'Open Current handover. If there is no handover yet for your active shift, choose Start handover.',
      'Select the incoming staff member and write the summary. Save draft keeps your work without submitting.',
      'Add each outstanding task with a priority, and log any incidents with their severity and time.',
      'The Ready to submit panel lists any mandatory items still missing; Submit stays disabled until they are complete.',
      'Submitting locks the record and notifies the incoming staff member. Unresolved tasks from the previous shift are carried in automatically.',
    ],
    faq: [
      ['Can I change a handover after submitting it?', 'No. Submitted handovers are locked so the record stays trustworthy. If something needs correcting, the incoming staff member can raise a query and you answer it with a clarification.'],
      ['What does "Carried forward" mean?', 'The task was still open or in progress at the end of the previous shift, so it was copied into this handover and linked to the original.'],
      ['Someone raised a query on my handover.', 'It appears at the top of Current handover with their question. Send a clarification; they are notified and can then acknowledge.'],
    ],
  },
  {
    role: 'incoming_staff',
    icon: Handshake,
    title: 'Acknowledge or raise a query',
    steps: [
      'Awaiting action lists handovers assigned to you; the oldest one opens first.',
      'Read the summary, tasks (carried-forward items are tagged) and incidents from top to bottom.',
      'Choose Acknowledge to confirm you have received and understood it. You are asked to confirm, and the acknowledgement is recorded against your name.',
      'If anything is unclear, choose Raise query and describe what needs clarifying. The outgoing staff member is notified.',
    ],
    faq: [
      ['Why can\'t I acknowledge a handover?', 'If you raised a query, the handover waits for the outgoing staff member\'s clarification before you can acknowledge it.'],
      ['Where are handovers I have already acknowledged?', 'Under All handovers. Select any row to open the full record.'],
    ],
  },
  {
    role: 'supervisor',
    icon: ShieldCheck,
    title: 'Review and escalate',
    steps: [
      'Overview shows handover counts by status and department. Anything still unacknowledged two hours after shift start is flagged in red.',
      'Review queue lists acknowledged handovers. Open one, add comments if needed, then choose Approve & close or Escalate.',
      'Escalated lists open escalations. When the issue is dealt with, choose Mark resolved & close.',
      'Search finds records by keyword, status or shift date.',
    ],
    faq: [
      ['Is there a separate manager role?', 'No. The Supervisor role covers supervisors and managers.'],
      ['Can I see other departments?', 'Supervisors see their own department. Administrators can see every department.'],
    ],
  },
  {
    role: 'admin',
    icon: UserCog,
    title: 'Manage users and templates',
    steps: [
      'Users: create accounts with New user, change a role or department with Edit, and remove access with Deactivate. Accounts are never deleted, so their history stays intact.',
      'Access requests: approve a request by choosing the role, department and staff number; the temporary password is shown once. Or reject it with an optional reason.',
      'Templates: choose which fields each department\'s handover must include and their minimums. Every save creates a new version, and earlier versions can be loaded back into the editor.',
    ],
    faq: [
      ['Can someone sign up on their own?', 'No. They submit a request from the sign-in page, and only an administrator approving it creates an account.'],
    ],
  },
];

const GENERAL_FAQ = [
  ['I don\'t have an account.', <>Use <Link to="/request-access" className="font-medium text-accent-fg underline-offset-2 hover:underline">Request access</Link>. An administrator reviews every request and gives you your sign-in details once approved.</>],
  ['I forgot my password.', 'There is no self-service reset. Contact your administrator or the support desk below to have it reset.'],
  ['Why was I signed out?', 'Sessions end after 30 minutes, and immediately if an administrator changes your role or department or deactivates your account.'],
  ['Can I use a dark theme?', 'Yes. Use the sun/moon button in the header. Your choice is remembered on this device.'],
];

const KEYS = [
  [['Tab'], ['Shift', 'Tab'], 'Move to the next or previous control.'],
  [['Enter'], null, 'Activate a button or link, or open the highlighted table row.'],
  [['Space'], null, 'Tick a checkbox, or open the highlighted table row.'],
  [['Esc'], null, 'Close a dialog, menu or side panel without making changes.'],
  [['←'], ['→'], 'Move between options in priority and severity pickers and in menus.'],
  [['Tab'], null, 'Pressed first on any page, shows "Skip to content" to jump past the header.'],
];

function Kbd({ children }) {
  return <kbd className="rounded-md border border-ink-300 bg-ink-50 px-1.5 py-0.5 font-mono text-meta text-fg shadow-[inset_0_-1px_0_var(--color-ink-300)]">{children}</kbd>;
}

function Faq({ items }) {
  return (
    <div className="divide-y divide-ink-200 rounded-lg border border-ink-200">
      {items.map(([q, a]) => (
        <details key={q} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-medium text-fg hover:bg-ink-50 [&::-webkit-details-marker]:hidden">
            {q}
            <ChevronDown aria-hidden className="size-4 shrink-0 text-ink-500 transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-4 text-ink-700">{a}</div>
        </details>
      ))}
    </div>
  );
}

function RoleGuide({ guide, mine }) {
  const { role, icon: Icon, title, steps, faq } = guide;
  return (
    <Card
      id={`role-${role}`}
      className={cx('scroll-mt-28', mine && 'ring-2 ring-brand-red/40')}
      title={title}
      subtitle={ROLE_LABEL[role]}
      icon={Icon}
      actions={mine ? <span className="rounded-full bg-status-red-soft px-2 py-0.5 text-meta font-medium text-status-red ring-1 ring-status-red-line ring-inset">Your role</span> : null}
    >
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink-100 text-meta font-semibold text-ink-700 tabular-nums">{i + 1}</span>
            <p className="pt-0.5 text-ink-800">{s}</p>
          </li>
        ))}
      </ol>
      <h3 className="mt-6 mb-2 text-sm font-semibold text-fg">Common questions</h3>
      <Faq items={faq} />
    </Card>
  );
}

export default function Help() {
  const { claims } = useAuth();
  const { hash } = useLocation();
  const myRole = claims?.role;
  const guides = myRole
    ? [...ROLE_GUIDES].sort((a, b) => (b.role === myRole) - (a.role === myRole))
    : ROLE_GUIDES;

  // Router navigation doesn't scroll to #fragments by itself.
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }, [hash]);

  return (
    <div className="min-h-screen bg-ink-50">
      <a href="#main" className="sr-only z-[60] rounded-md bg-surface px-3 py-2 font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <PublicHeader />

      <main id="main" className="mx-auto max-w-screen-lg animate-page-in px-4 pt-32 pb-16 sm:px-6 lg:px-8">
        <h1 className="text-title tracking-tight text-fg">Help centre</h1>
        <p className="mt-1 text-ink-600">How to use Shift Handover in each role, keyboard controls, and who to contact.</p>

        <nav aria-label="Help sections" className="mt-5 flex flex-wrap gap-2">
          {guides.map((g) => (
            <a key={g.role} href={`#role-${g.role}`} className="rounded-full border border-ink-200 bg-surface px-3 py-1 text-meta font-medium text-ink-700 hover:border-ink-300 hover:text-fg">
              {ROLE_LABEL[g.role]}
            </a>
          ))}
          <a href="#faq" className="rounded-full border border-ink-200 bg-surface px-3 py-1 text-meta font-medium text-ink-700 hover:border-ink-300 hover:text-fg">General questions</a>
          <a href="#keyboard" className="rounded-full border border-ink-200 bg-surface px-3 py-1 text-meta font-medium text-ink-700 hover:border-ink-300 hover:text-fg">Keyboard</a>
          <a href="#contact" className="rounded-full border border-ink-200 bg-surface px-3 py-1 text-meta font-medium text-ink-700 hover:border-ink-300 hover:text-fg">Contact</a>
        </nav>

        {myRole && (
          <Callout tone="info" className="mt-6">
            You are signed in as <strong>{ROLE_LABEL[myRole]}</strong>, so your guide is shown first.
          </Callout>
        )}

        <div className="mt-6 space-y-6">
          {guides.map((g) => <RoleGuide key={g.role} guide={g} mine={g.role === myRole} />)}

          <Card id="faq" className="scroll-mt-28" title="General questions" icon={LifeBuoy}>
            <Faq items={GENERAL_FAQ} />
          </Card>

          <Card id="keyboard" className="scroll-mt-28" title="Keyboard controls" subtitle="Everything in Shift Handover can be done without a mouse." icon={Keyboard}>
            <dl className="divide-y divide-ink-200">
              {KEYS.map(([a, b, what]) => (
                <div key={what} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:gap-6">
                  <dt className="flex shrink-0 items-center gap-1 sm:w-44">
                    {a.map((k) => <Kbd key={k}>{k}</Kbd>)}
                    {b && <><span className="px-1 text-meta text-ink-500">/</span>{b.map((k) => <Kbd key={k}>{k}</Kbd>)}</>}
                  </dt>
                  <dd className="text-ink-700">{what}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card id="contact" className="scroll-mt-28" title="Contact support" icon={LifeBuoy}>
            {SUPPORT.email || SUPPORT.phone ? (
              <ul className="space-y-3">
                {SUPPORT.email && (
                  <li className="flex items-center gap-3">
                    <Mail aria-hidden className="size-4 text-ink-500" />
                    <a href={`mailto:${SUPPORT.email}`} className="font-medium text-accent-fg underline-offset-2 hover:underline">{SUPPORT.email}</a>
                  </li>
                )}
                {SUPPORT.phone && (
                  <li className="flex items-center gap-3">
                    <Phone aria-hidden className="size-4 text-ink-500" />
                    <a href={telHref(SUPPORT.phone)} className="font-medium text-accent-fg underline-offset-2 hover:underline">{SUPPORT.phone}</a>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-ink-700">Contact your system administrator for help with your account or access.</p>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
