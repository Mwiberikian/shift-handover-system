import { Link } from 'react-router-dom';
import { CircleHelp, Mail, Phone } from 'lucide-react';
import { SUPPORT, telHref } from '../../lib/support';

const LINK = 'inline-flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-white/75 transition-colors hover:text-white';

// Slim bar above every header: support contacts on the left (each hidden when
// unset in .env), Help on the right. Always-dark chrome in both themes.
export default function UtilityBar() {
  return (
    <div className="h-8 border-b border-white/10 bg-brand-black text-meta">
      <div className="mx-auto flex h-full max-w-screen-2xl items-center justify-between gap-3 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          {SUPPORT.email && (
            <a href={`mailto:${SUPPORT.email}`} className={LINK} aria-label={`Email support: ${SUPPORT.email}`}>
              <Mail aria-hidden className="size-3.5 shrink-0" />
              <span className="hidden truncate sm:inline">{SUPPORT.email}</span>
            </a>
          )}
          {SUPPORT.phone && (
            <a href={telHref(SUPPORT.phone)} className={LINK} aria-label={`Call support: ${SUPPORT.phone}`}>
              <Phone aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{SUPPORT.phone}</span>
            </a>
          )}
        </div>
        <Link to="/help" className={LINK}>
          <CircleHelp aria-hidden className="size-3.5 shrink-0" />
          Help
        </Link>
      </div>
    </div>
  );
}
