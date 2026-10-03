import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import runwayUrl from '../../assets/images/runway-dusk.webp';
import { cx } from '../../lib/format';
import Brand from './Brand';

// Frame for the public sign-in / request-access pages: runway photo, a frosted
// glass card with the logo, and an audit notice + back link beneath it.
// `as="form"` makes the card itself the form element.
export default function AuthShell({ as: Card = 'div', wide = false, children, footer, ...cardProps }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-brand-black px-4 py-10">
      <img src={runwayUrl} alt="" aria-hidden className="absolute inset-0 size-full object-cover" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-brand-black/55 via-brand-black/25 to-brand-black/70" />

      <main className={cx('relative w-full animate-page-in', wide ? 'max-w-lg' : 'max-w-sm')}>
        <Card className="glass-light overflow-hidden rounded-2xl shadow-pop" {...cardProps}>
          <div aria-hidden className="h-1 bg-brand-red" />
          <div className="space-y-5 p-6 sm:p-8">
            <div className="flex flex-col items-center gap-2 border-b border-zinc-900/10 pb-5 text-center">
              <Brand showName={false} size="lg" />
              <p className="text-body font-medium text-zinc-700">Shift Handover Management System</p>
            </div>
            {children}
          </div>
          {footer && <div className="border-t border-zinc-900/10 bg-white/50 px-6 py-4 text-center sm:px-8">{footer}</div>}
        </Card>

        <p className="mt-6 text-center text-meta text-zinc-200 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
          <ShieldCheck aria-hidden className="mr-1 inline size-3.5 -translate-y-px" />
          Authorised personnel only. Sign-ins and handover actions are recorded in the audit trail.
        </p>
        <p className="mt-3 text-center">
          <Link to="/" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-meta font-medium text-zinc-200 hover:text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
            <ArrowLeft aria-hidden className="size-3.5" /> Back to home
          </Link>
        </p>
      </main>
    </div>
  );
}

// Inline text link used inside the glass card.
export function CardLink({ to, children }) {
  return (
    <Link to={to} className="font-semibold text-brand-red-darker underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
