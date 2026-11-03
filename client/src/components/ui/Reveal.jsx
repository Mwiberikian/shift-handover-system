import { cx } from '../../lib/format';
import useReveal from '../../lib/useReveal';

// Start positions; each ends at translate 0. Opacity and transform only, so
// revealing never moves anything else on the page (no layout shift).
const FROM = {
  up: 'translate-y-5',
  left: '-translate-x-5',
  right: 'translate-x-5',
  fade: '',
};

// Fades and slides its children in the first time they scroll into view.
// For public marketing pages only: never wrap forms, tables or app screens.
// With reduced motion or no IntersectionObserver it renders the children
// plainly, fully visible, with no transform or transition.
export default function Reveal({ as: Tag = 'div', delay = 0, direction = 'up', className, style, children, ...props }) {
  const [ref, shown, motionOk] = useReveal();

  if (!motionOk) {
    return <Tag className={className} style={style} {...props}>{children}</Tag>;
  }

  return (
    <Tag
      ref={ref}
      data-revealed={shown || undefined}
      className={cx(
        'transition-[opacity,translate] duration-600 ease-out motion-reduce:transition-none',
        shown ? 'translate-0 opacity-100' : cx('opacity-0', FROM[direction] ?? FROM.up),
        className,
      )}
      style={delay ? { transitionDelay: `${delay}ms`, ...style } : style}
      {...props}
    >
      {children}
    </Tag>
  );
}
