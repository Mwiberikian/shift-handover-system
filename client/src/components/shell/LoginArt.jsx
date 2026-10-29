import { useId } from 'react';
import { cx } from '../../lib/format';

// Decorative art for the brand panel on the sign-in pages: a dashed flight
// path from one station to the next, with two overlapping cards (the handover)
// along it. Drawn in white and the brand reds only.
//
// To use a photo instead: put the image in client/public (for example
// client/public/login-art.webp) and set LOGIN_ART_SRC = '/login-art.webp'.
// It is rendered as a decorative <img alt="">.
export const LOGIN_ART_SRC = null;

export default function LoginArt({ src = LOGIN_ART_SRC, className }) {
  const id = useId().replace(/:/g, '');
  if (src) return <img src={src} alt="" aria-hidden className={cx('w-full rounded-2xl object-cover', className)} />;

  const glow = `${id}-glow`;
  const trail = `${id}-trail`;
  return (
    <svg viewBox="0 0 480 340" aria-hidden focusable="false" className={cx('w-full', className)}>
      <defs>
        <radialGradient id={glow}>
          <stop offset="0" style={{ stopColor: 'var(--color-brand-red)', stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: 'var(--color-brand-red)', stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id={trail} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.25" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.9" />
        </linearGradient>
      </defs>

      {/* Soft shapes */}
      <circle cx="372" cy="96" r="120" fill={`url(#${glow})`} />
      <circle cx="84" cy="268" r="70" fill="#fff" fillOpacity="0.05" />
      <rect x="292" y="210" width="120" height="120" rx="28" fill="#fff" fillOpacity="0.04" transform="rotate(18 352 270)" />

      {/* Rings around the departure station */}
      <g fill="none" stroke="#fff">
        <circle cx="84" cy="268" r="30" strokeOpacity="0.25" />
        <circle cx="84" cy="268" r="50" strokeOpacity="0.12" />
      </g>

      {/* Flight path */}
      <path
        d="M84 268 C 150 150, 250 250, 300 170 S 380 70, 396 64"
        fill="none"
        stroke={`url(#${trail})`}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="1 11"
      />
      <path d="M380 56 l20 6 -14 15" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Stations */}
      <circle cx="84" cy="268" r="9" style={{ fill: 'var(--color-brand-red)' }} stroke="#fff" strokeWidth="3" />
      <circle cx="404" cy="64" r="5" fill="#fff" />

      {/* Handover: one card passing to the next */}
      <g transform="translate(206 168) rotate(-12)">
        <rect width="78" height="54" rx="10" fill="#fff" fillOpacity="0.1" stroke="#fff" strokeOpacity="0.35" />
        <rect x="12" y="14" width="40" height="5" rx="2.5" fill="#fff" fillOpacity="0.5" />
        <rect x="12" y="26" width="28" height="5" rx="2.5" fill="#fff" fillOpacity="0.3" />
      </g>
      <g transform="translate(236 184) rotate(6)">
        <rect width="78" height="54" rx="10" style={{ fill: 'var(--color-brand-red-dark)' }} stroke="#fff" strokeOpacity="0.55" />
        <rect x="12" y="14" width="44" height="5" rx="2.5" fill="#fff" fillOpacity="0.85" />
        <rect x="12" y="26" width="30" height="5" rx="2.5" fill="#fff" fillOpacity="0.55" />
        <circle cx="62" cy="40" r="6" fill="#fff" />
      </g>

      {/* Scattered points */}
      <g fill="#fff">
        <circle cx="168" cy="72" r="2" fillOpacity="0.5" />
        <circle cx="236" cy="40" r="1.5" fillOpacity="0.35" />
        <circle cx="440" cy="196" r="2" fillOpacity="0.4" />
        <circle cx="40" cy="150" r="1.5" fillOpacity="0.35" />
      </g>
    </svg>
  );
}
