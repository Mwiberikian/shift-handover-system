// Q4: the phone layout. A bottom tab bar per role over the same routes, the
// Me sheet, tables as cards, and 16 px inputs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import TabBar from '../components/shell/TabBar';
import { NAV, TABS, isTabActive, tabsFor } from '../components/shell/nav';
import Table from '../components/ui/Table';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const labels = (role) => TABS[role].map((t) => t.label);

describe('tabs per role', () => {
  test('match the brief, in order', () => {
    expect(labels('outgoing_staff')).toEqual(['Handover', 'Reports', 'Messages', 'Me']);
    expect(labels('incoming_staff')).toEqual(['Inbox', 'Reports', 'Messages', 'Me']);
    expect(labels('supervisor')).toEqual(['Overview', 'Live', 'Reports', 'Messages']);
    expect(labels('admin')).toEqual(['Users', 'Templates', 'Requests', 'Me']);
  });

  test('reuse the sidebar routes; screens not built yet stay hidden', () => {
    const navPaths = new Set(Object.values(NAV).flat().map((i) => i.to));
    for (const role of Object.keys(TABS)) {
      for (const tab of tabsFor(role)) {
        if (!tab.me) expect(navPaths.has(tab.to)).toBe(true);
      }
    }
    // The live board has no route yet (see REQUIREMENTS_STATUS).
    expect(Object.values(TABS).flat().filter((t) => t.planned).map((t) => t.label)).toEqual(['Live']);
    expect(tabsFor('supervisor').map((t) => t.label)).toEqual(['Overview', 'Reports', 'Messages']);
    expect(tabsFor('outgoing_staff').map((t) => t.label)).toEqual(['Handover', 'Reports', 'Messages', 'Me']);
  });

  test('Overview stays active on every supervisor screen except Live', () => {
    const overview = TABS.supervisor[0];
    expect(isTabActive(overview, '/supervisor/queue')).toBe(true);
    expect(isTabActive(overview, '/supervisor/live')).toBe(false);
    expect(isTabActive(TABS.outgoing_staff[0], '/outgoing/history')).toBe(true);
    expect(isTabActive(TABS.outgoing_staff[0], '/outgoing-other')).toBe(false);
  });
});

describe('TabBar', () => {
  const PROFILE = { full_name: 'Amina Otieno', role: 'outgoing_staff', department_name: 'Ground Operations', email_notifications: true };
  const renderBar = (role, route, onLogout = vi.fn()) => {
    tokenStore.set(fakeToken(role));
    api.get.mockResolvedValue({ data: PROFILE });
    renderWithProviders(
      <Routes><Route path="*" element={<TabBar role={role} onLogout={onLogout} />} /></Routes>,
      { route },
    );
    return onLogout;
  };
  afterEach(() => document.documentElement.classList.remove('with-tabbar'));

  test('links to the routes, marks the current one and lifts content above itself', () => {
    renderBar('outgoing_staff', '/outgoing/history');
    const bar = screen.getByRole('navigation', { name: 'Tabs' });
    expect(within(bar).getByRole('link', { name: 'Handover' })).toHaveAttribute('href', '/outgoing');
    expect(within(bar).getByRole('link', { name: 'Handover' })).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByRole('link', { name: 'Messages' })).not.toHaveAttribute('aria-current');
    expect(document.documentElement).toHaveClass('with-tabbar');
  });

  test('every tab is at least 44 px tall (h-16 = 64 px)', () => {
    renderBar('admin', '/admin/users');
    const bar = screen.getByRole('navigation', { name: 'Tabs' });
    for (const el of [...within(bar).getAllByRole('link'), within(bar).getByRole('button', { name: 'Me' })]) {
      expect(el.className).toMatch(/\bh-16\b/);
    }
  });

  test('Me opens the account sheet with the other screens, account rows and log out', async () => {
    const onLogout = renderBar('outgoing_staff', '/outgoing');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Me' }));
    const sheet = await screen.findByRole('dialog', { name: 'Me' });
    expect(within(sheet).getByRole('link', { name: 'My handovers' })).toHaveAttribute('href', '/outgoing/history');
    expect(within(sheet).getByRole('link', { name: 'My shifts' })).toHaveAttribute('href', '/shifts');
    expect(within(sheet).queryByRole('link', { name: 'Messages' })).toBeNull(); // it has a tab
    expect(within(sheet).getByRole('switch', { name: /email alerts/i })).toBeInTheDocument();
    expect(within(sheet).getByRole('switch', { name: 'Dark theme' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Change password' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Log out' }));
    expect(onLogout).toHaveBeenCalled();
  });
});

describe('Table on a phone', () => {
  const COLUMNS = [
    { key: 'name', header: 'Name' },
    { key: 'dept', header: 'Department', hideBelow: 'lg' },
    { key: 'actions', header: '', render: () => <button type="button">Edit</button> },
  ];
  const ROWS = [{ id: 1, name: 'Amina', dept: 'Ground Ops' }, { id: 2, name: 'Brian', dept: 'Maintenance' }];
  const phone = (matches) => vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: matches && query === '(max-width: 47.98rem)', media: query, addEventListener() {}, removeEventListener() {},
  }));
  afterEach(() => vi.restoreAllMocks());

  test('renders each row as a card with every column, hidden ones included', () => {
    phone(true);
    renderWithProviders(<Table columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="Users" />);
    expect(screen.queryByRole('table')).toBeNull();
    const cards = within(screen.getByRole('list', { name: 'Users' })).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('Department')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Ground Ops')).toBeInTheDocument();
    expect(within(cards[1]).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  test('clickable rows become buttons that open with a tap or Enter', async () => {
    phone(true);
    const onRowClick = vi.fn();
    renderWithProviders(<Table columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} onRowClick={onRowClick} rowLabel={(r) => `Open ${r.name}`} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open Amina' }));
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[0]);
    screen.getByRole('button', { name: 'Open Brian' }).focus();
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[1]);
  });

  test('stays a table from md up', () => {
    phone(false);
    renderWithProviders(<Table columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="Users" />);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});

describe('phone CSS', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
  test('inputs are 16 px below md, so iOS does not zoom', () => {
    expect(css).toMatch(/@media \(width < 48rem\) \{\s*input:not\(\[type='checkbox'\], \[type='radio'\], \[type='range'\]\), select, textarea \{\s*font-size: 1rem;/);
  });
  test('sticky action bars sit above the tab bar', () => {
    expect(css).toMatch(/html\.with-tabbar \{\s*--tabbar-h: 4rem;/);
    for (const page of ['OutgoingPage', 'IncomingPage']) {
      expect(readFileSync(resolve(process.cwd(), `src/pages/${page}.jsx`), 'utf8')).toContain('bottom-[calc(var(--tabbar-h,0px)+var(--safe-bottom)');
    }
  });
});
