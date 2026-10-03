import { cx } from '../../lib/format';

// Pretty-printed, syntax-highlighted JSON (read-only). Tokens are matched with
// one regex over JSON.stringify output, so no parser dependency is needed.
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g;

function highlight(text) {
  const out = [];
  let last = 0;
  let m;
  let i = 0;
  while ((m = TOKEN.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [whole, str, colon, lit, num, punct] = m;
    if (str && colon) out.push(<span key={i++} className="text-sky-300">{str}</span>, colon);
    else if (str) out.push(<span key={i++} className="text-emerald-300">{str}</span>);
    else if (lit) out.push(<span key={i++} className="text-violet-300">{lit}</span>);
    else if (num) out.push(<span key={i++} className="text-amber-300">{num}</span>);
    else if (punct) out.push(<span key={i++} className="text-zinc-400">{punct}</span>);
    else out.push(whole);
    last = TOKEN.lastIndex;
  }
  out.push(text.slice(last));
  return out;
}

export default function JsonView({ value, className, label }) {
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className={cx('overflow-x-auto rounded-lg bg-brand-black p-4 font-mono text-[13px] leading-relaxed text-zinc-100', className)}
    >
      <code>{highlight(JSON.stringify(value, null, 2))}</code>
    </pre>
  );
}
