import {
  ArrowRight, ClipboardList, Eye, Handshake, LogIn, ScrollText, Send,
} from 'lucide-react';
import Brand from '../components/shell/Brand';
import ThemeToggle from '../components/shell/ThemeToggle';
import { ButtonLink, buttonClass } from '../components/ui';
import aircraftUrl from '../assets/images/aircraft-gate.webp';
import towerUrl from '../assets/images/control-tower.webp';
import boardUrl from '../assets/images/departure-board.webp';
import terminalUrl from '../assets/images/terminal.webp';

// The four capabilities the system actually implements; copy describes real behaviour.
const FEATURES = [
  {
    icon: ClipboardList,
    title: 'Structured handover documentation',
    body: 'Each department has its own handover template. Mandatory fields are checked before a handover can be submitted, and unresolved tasks carry forward to the next shift automatically.',
  },
  {
    icon: Handshake,
    title: 'Bidirectional acknowledgement',
    body: 'Incoming staff formally acknowledge every handover or raise a query. A query goes straight back to the outgoing staff member, so nothing is accepted on assumption.',
  },
  {
    icon: Eye,
    title: 'Real-time supervisor oversight',
    body: 'Supervisors see handover status across their departments, with anything still unacknowledged two hours after shift start flagged. They approve or escalate from a single review queue.',
  },
  {
    icon: ScrollText,
    title: 'Complete audit trail',
    body: 'Submitted handovers are locked against editing. Sign-ins, submissions, acknowledgements and reviews are written to an append-only audit log recording who acted and when.',
  },
];

const STEPS = [
  { icon: ClipboardList, title: 'Prepare', body: 'The outgoing shift completes the department checklist, logs tasks and incidents, and assigns the incoming staff member.' },
  { icon: Send, title: 'Hand over', body: 'Submission locks the record and notifies the incoming shift. Open tasks from the previous shift are carried in.' },
  { icon: Handshake, title: 'Acknowledge', body: 'The incoming shift confirms receipt or queries anything unclear before taking responsibility.' },
  { icon: Eye, title: 'Review', body: 'A supervisor reviews the acknowledged handover and closes it, or escalates it for follow-up.' },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-surface text-fg">
      <a href="#main" className="sr-only z-[60] rounded-md bg-surface px-3 py-2 font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>

      {/* Fixed glass bar: the hero photo, then page content, scroll beneath it. */}
      <header className="glass-dark fixed inset-x-0 top-0 z-40 border-b border-white/10">
        <div className="mx-auto flex h-16 max-w-screen-xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Brand showName={false} className="sm:hidden" />
          <Brand className="hidden sm:flex" />
          <nav aria-label="Primary" className="flex items-center gap-2 sm:gap-4">
            <a href="#features" className="hidden rounded-md px-2 py-1 text-sm font-medium text-white/80 transition-colors hover:text-white sm:inline">Features</a>
            <a href="#how-it-works" className="hidden rounded-md px-2 py-1 text-sm font-medium text-white/80 transition-colors hover:text-white md:inline">How it works</a>
            <ThemeToggle />
            <ButtonLink to="/login" variant="primary" icon={LogIn}>Log In</ButtonLink>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="relative isolate flex min-h-[92vh] items-center overflow-hidden bg-brand-black pt-16">
          <img src={aircraftUrl} alt="" aria-hidden className="absolute inset-0 -z-10 size-full object-cover" />
          <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-brand-black/80 via-brand-black/40 to-brand-black/10" />
          <div className="mx-auto w-full max-w-screen-xl px-4 py-16 sm:px-6 lg:px-8">
            <div className="glass-light max-w-2xl animate-page-in rounded-2xl p-6 shadow-pop sm:p-10">
              <p className="flex items-center gap-2 text-meta font-semibold tracking-widest text-accent-fg uppercase">
                <span aria-hidden className="h-0.5 w-6 bg-brand-red" /> Airline operations
              </p>
              <h1 className="mt-4 text-3xl leading-tight font-bold tracking-tight text-balance text-fg sm:text-5xl sm:leading-[1.1]">
                Every shift handover documented, acknowledged and accountable.
              </h1>
              <p className="mt-5 text-base leading-relaxed text-ink-700 sm:text-lg">
                Shift Handover replaces verbal and paper handovers with a structured digital record. The outgoing shift
                completes a department checklist, the incoming shift formally accepts it, and supervisors see every open
                handover as it happens.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink to="/login" variant="primary" size="lg" icon={LogIn}>Log In</ButtonLink>
                <a href="#features" className={buttonClass({ variant: 'secondary', size: 'lg' })}>
                  See what it does <ArrowRight aria-hidden className="size-4" />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" aria-labelledby="features-title" className="scroll-mt-16 bg-ink-50 py-20 sm:py-24">
          <div className="mx-auto max-w-screen-xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-meta font-semibold tracking-widest text-accent-fg uppercase">Capabilities</p>
              <h2 id="features-title" className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Built around the moment responsibility changes hands</h2>
              <p className="mt-3 text-ink-600 sm:text-base">Four things every handover gets, whichever department it comes from.</p>
            </div>
            <ul className="mt-12 grid gap-5 sm:grid-cols-2">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <li key={title} className="group rounded-xl border border-ink-200 bg-surface p-6 shadow-card transition-shadow hover:shadow-pop">
                  <span className="grid size-11 place-items-center rounded-lg bg-status-red-soft text-accent-fg ring-1 ring-status-red-line ring-inset">
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <h3 className="mt-5 text-section">{title}</h3>
                  <p className="mt-2 leading-relaxed text-ink-600">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works, beside the control tower photo */}
        <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-16 bg-surface py-20 sm:py-24">
          <div className="mx-auto grid max-w-screen-xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div className="relative order-last lg:order-first">
              <img src={towerUrl} alt="Airport control tower against a cloudy sky" loading="lazy" className="aspect-[4/5] w-full rounded-2xl object-cover shadow-pop sm:aspect-[4/3] lg:aspect-[4/5]" />
              <img
                src={boardUrl}
                alt="Airport departures board"
                loading="lazy"
                className="absolute -right-3 -bottom-6 hidden w-2/5 rounded-xl border-4 border-surface object-cover shadow-pop sm:block lg:-right-8"
              />
            </div>
            <div>
              <p className="text-meta font-semibold tracking-widest text-accent-fg uppercase">How it works</p>
              <h2 id="how-title" className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">One record, from the outgoing shift to supervisor sign-off</h2>
              <ol className="mt-8 space-y-6">
                {STEPS.map(({ icon: Icon, title, body }, i) => (
                  <li key={title} className="flex gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-fg text-surface">
                      <Icon aria-hidden className="size-[18px]" />
                    </span>
                    <div>
                      <h3 className="text-section">
                        <span className="mr-2 text-ink-500 tabular-nums">{String(i + 1).padStart(2, '0')}</span>{title}
                      </h3>
                      <p className="mt-1 leading-relaxed text-ink-600">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Call to action over the terminal photo */}
        <section aria-labelledby="cta-title" className="relative isolate overflow-hidden bg-brand-black py-20 sm:py-24">
          <img src={terminalUrl} alt="" aria-hidden loading="lazy" className="absolute inset-0 -z-10 size-full object-cover opacity-35" />
          <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-1 bg-brand-red" />
          <div className="mx-auto flex max-w-screen-xl flex-col items-start gap-8 px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="max-w-2xl">
              <h2 id="cta-title" className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Starting or finishing a shift?</h2>
              <p className="mt-3 text-white/85 sm:text-base">Log in with your staff number or work email to prepare, acknowledge or review handovers for your department.</p>
            </div>
            <ButtonLink to="/login" variant="primary" size="lg" icon={LogIn}>Log In</ButtonLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-brand-black">
        <div className="mx-auto flex max-w-screen-xl flex-col gap-3 px-4 py-8 text-meta text-white/65 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <Brand size="md" />
          <p>Photography via Unsplash.</p>
        </div>
      </footer>
    </div>
  );
}
