import { Link } from 'react-router-dom';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { BookOpen, CircleHelp, LifeBuoy } from 'lucide-react';

const ITEM = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-body text-ink-800 data-focus:bg-ink-100 data-focus:text-fg';

// "?" menu in the dark header bars. Arrow keys move between items; Escape closes.
export default function HelpMenu() {
  return (
    <Menu>
      <MenuButton
        aria-label="Help"
        className="grid size-9 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white data-open:bg-white/10 data-open:text-white"
      >
        <CircleHelp aria-hidden className="size-[18px]" />
      </MenuButton>
      <MenuItems
        transition
        anchor={{ to: 'bottom end', gap: 8, padding: 8 }}
        className="z-50 w-56 rounded-xl border border-ink-200 bg-surface p-1.5 shadow-pop transition duration-150 ease-out focus:outline-none data-closed:-translate-y-1 data-closed:opacity-0"
      >
        <MenuItem>
          <Link to="/help" className={ITEM}>
            <BookOpen aria-hidden className="size-4 text-ink-500" /> Help centre
          </Link>
        </MenuItem>
        <MenuItem>
          <Link to="/help#contact" className={ITEM}>
            <LifeBuoy aria-hidden className="size-4 text-ink-500" /> Contact support
          </Link>
        </MenuItem>
      </MenuItems>
    </Menu>
  );
}
