import { Link } from 'react-router-dom';
import { ArrowLeft, Camera, CircleHelp, Mail, Phone, ShieldCheck } from 'lucide-react';
import { cx } from '../../lib/format';
import { SUPPORT, telHref } from '../../lib/support';
import { buttonClass } from '../ui/Button';
import Brand from './Brand';
import LoginArt from './LoginArt';
import ThemeToggle from './ThemeToggle';

const WORDMARK = 'Shift Handover Management System';
const TAGLINE = 'Hand over every shift, without the guesswork';
// Brand-panel photos (public/images, resized by `npm run photos`). The brand
// gradient sits over each one at `overlay` opacity so the white text keeps
// AA contrast: the login photo is light and pastel, so it needs more cover
// than the dark sign-up photo. `sizes` is the rendered width under
// object-cover: the wider of the panel (13/24 of the viewport) and the
// panel's height times the photo's aspect ratio.
export const AUTH_PHOTOS = {
  login: { name: 'login', width: 1600, height: 2400, position: '40% 60%', overlay: 0.88, sizes: 'max(55vw, 67vh)' },
  signup: { name: 'signup', width: 1600, height: 1067, position: '70% 55%', overlay: 0.8, sizes: 'max(55vw, 150vh)' },
};
// Below lg the brand panel is hidden; this 1 px GIF stands in for the photo
// there, so phones do not download it.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const srcset = (name, ext) => `/images/${name}-800.${ext} 800w, /images/${name}-1600.${ext} 1600w`;

// Decorative cover photo for the brand panel, under the gradient.
function PanelPhoto({ photo }) {
  return (
    <>
      {/* Out of the panel's flex flow, under the gradient. */}
      <picture className="absolute inset-0 -z-10">
        <source media="(max-width: 63.98rem)" srcSet={BLANK} />
        <source type="image/webp" srcSet={srcset(photo.name, 'webp')} sizes={photo.sizes} />
        <img
          src={`/images/${photo.name}-800.jpg`}
          srcSet={srcset(photo.name, 'jpg')}
          sizes={photo.sizes}
          width={photo.width}
          height={photo.height}
          alt=""
          aria-hidden
          loading="eager"
          fetchpriority="high"
          decoding="async"
          className="size-full object-cover"
          style={{ objectPosition: photo.position }}
        />
      </picture>
      <div aria-hidden className="auth-gradient absolute inset-0 -z-10" style={{ opacity: photo.overlay }} />
    </>
  );
}

const FOOTER_LINK = 'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-1.5 transition-colors hover:text-fg';

// Frame for the public sign-in / request-access / change-password pages.
// lg and up: brand panel (gradient, headline, art) on the left, the form on a
// plain surface on the right. Below lg: a compact gradient band above the form.
// `as="form"` makes the form column itself the form element. `photo` (a key of
// AUTH_PHOTOS) puts that photo behind the gradient in place of the drawn art;
// the panel's own gradient and brand-black stay as the fallback underneath.
export default function AuthShell({ as: Card = 'div', wide = false, photo, children, footer, ...cardProps }) {
  const panelPhoto = AUTH_PHOTOS[photo];
  return (
    <div className="min-h-screen bg-surface lg:grid lg:grid-cols-[minmax(0,13fr)_minmax(0,11fr)]">
      <div className="auth-gradient relative isolate hidden overflow-hidden text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:justify-between lg:gap-10 lg:p-12 xl:p-16">
        {panelPhoto && <PanelPhoto photo={panelPhoto} />}
        <p className="text-meta font-semibold tracking-[0.14em] text-white/90 uppercase">{WORDMARK}</p>
        <div className="max-w-xl animate-rise-in">
          <p className="text-display font-semibold text-white">{TAGLINE}</p>
          <p className="mt-5 max-w-md text-lead text-white">
            Record what happened, pass on what is still open, and know the next
            shift has seen it. Every handover is signed and kept on record.
          </p>
        </div>
        {!panelPhoto && <LoginArt className="mx-auto max-w-lg animate-rise-in" />}
      </div>

      <div className="flex min-h-screen flex-col">
        <header>
          <div className="auth-gradient px-4 py-5 text-white sm:px-6 lg:hidden">
            <p className="text-meta font-semibold tracking-[0.14em] text-white/90 uppercase">{WORDMARK}</p>
            <p className="mt-1 text-section text-white">{TAGLINE}</p>
          </div>
          <div className="flex items-center justify-between gap-2 px-2 pt-2 sm:px-4 lg:px-6 lg:pt-4">
            <Link to="/" className={buttonClass({ variant: 'ghost', shape: 'pill' })}>
              <ArrowLeft aria-hidden className="size-4" /> Go back
            </Link>
            <ThemeToggle tone="light" />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:py-12">
          <div className={cx('w-full animate-page-in', wide ? 'max-w-lg' : 'max-w-md')}>
            <Brand showName={false} className="mb-8" />
            <Card className="space-y-6" {...cardProps}>
              {children}
            </Card>
            {footer && <div className="mt-8 text-center">{footer}</div>}
            <p className="mt-8 flex items-start justify-center gap-1.5 text-center text-meta text-ink-600">
              <ShieldCheck aria-hidden className="mt-px size-3.5 shrink-0" />
              Authorised personnel only. Sign-ins and handover actions are recorded in the audit trail.
            </p>
          </div>
        </main>

        <footer className="flex flex-wrap items-center justify-center gap-x-4 border-t border-ink-200 px-4 text-meta text-ink-600">
          {SUPPORT.email && (
            <a href={`mailto:${SUPPORT.email}`} className={FOOTER_LINK} aria-label={`Email support: ${SUPPORT.email}`}>
              <Mail aria-hidden className="size-3.5 shrink-0" />{SUPPORT.email}
            </a>
          )}
          {SUPPORT.phone && (
            <a href={telHref(SUPPORT.phone)} className={FOOTER_LINK} aria-label={`Call support: ${SUPPORT.phone}`}>
              <Phone aria-hidden className="size-3.5 shrink-0" />{SUPPORT.phone}
            </a>
          )}
          <Link to="/help" className={FOOTER_LINK}>
            <CircleHelp aria-hidden className="size-3.5 shrink-0" />Help
          </Link>
          {panelPhoto && (
            <a href="/images/CREDITS.txt" className={FOOTER_LINK}>
              <Camera aria-hidden className="size-3.5 shrink-0" />Photo credits
            </a>
          )}
        </footer>
      </div>
    </div>
  );
}

// Inline text link used beside the form.
export function CardLink({ to, children }) {
  return (
    <Link to={to} className="font-semibold text-accent-fg underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
