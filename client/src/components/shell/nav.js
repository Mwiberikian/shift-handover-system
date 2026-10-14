import {
  Activity, AlertTriangle, CalendarClock, CalendarDays, CircleUser, ClipboardList, FileCog, FileText, History, Inbox, LayoutDashboard, ListChecks, MessagesSquare, Search, UserPlus,
  Users,
} from 'lucide-react';

// Sidebar links per role. Each role only ever sees its own entries.
const MESSAGES = { to: '/messages', label: 'Messages', icon: MessagesSquare, badge: 'messages' };
const MY_SHIFTS = { to: '/shifts', label: 'My shifts', icon: CalendarClock };

export const NAV = {
  outgoing_staff: [
    { to: '/outgoing', end: true, label: 'Current handover', icon: ClipboardList },
    { to: '/outgoing/history', label: 'My handovers', icon: History },
    MY_SHIFTS,
    MESSAGES,
  ],
  incoming_staff: [
    { to: '/incoming', end: true, label: 'Awaiting action', icon: Inbox },
    { to: '/incoming/history', label: 'All handovers', icon: History },
    MY_SHIFTS,
    MESSAGES,
  ],
  supervisor: [
    { to: '/supervisor', end: true, label: 'Overview', icon: LayoutDashboard },
    { to: '/supervisor/queue', label: 'Review queue', icon: ListChecks },
    { to: '/supervisor/escalated', label: 'Escalated', icon: AlertTriangle },
    { to: '/supervisor/search', label: 'Search', icon: Search },
    { to: '/supervisor/roster', label: 'Roster', icon: CalendarDays },
    MY_SHIFTS,
    MESSAGES,
  ],
  admin: [
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/admin/requests', label: 'Access requests', icon: UserPlus },
    { to: '/admin/templates', label: 'Templates', icon: FileCog },
    MESSAGES,
  ],
};

// Bottom tab bar below md (Q4): the same routes as the sidebar, four per role.
// 'me' opens the account sheet instead of a route. A tab marked `planned`
// points at a screen that is not built yet (shift reports, the supervisor live
// board) and stays hidden until its route exists; the sidebar and drawer still
// reach every built screen.
const TAB_MESSAGES = { key: 'messages', to: '/messages', label: 'Messages', icon: MessagesSquare, badge: 'messages' };
const TAB_REPORTS = { key: 'reports', to: '/reports', label: 'Reports', icon: FileText, planned: true };
const TAB_ME = { key: 'me', label: 'Me', icon: CircleUser, me: true };

export const TABS = {
  outgoing_staff: [{ key: 'handover', to: '/outgoing', label: 'Handover', icon: ClipboardList }, TAB_REPORTS, TAB_MESSAGES, TAB_ME],
  incoming_staff: [{ key: 'inbox', to: '/incoming', label: 'Inbox', icon: Inbox }, TAB_REPORTS, TAB_MESSAGES, TAB_ME],
  supervisor: [
    {
      key: 'overview', to: '/supervisor', label: 'Overview', icon: LayoutDashboard, match: (p) => p.startsWith('/supervisor') && !p.startsWith('/supervisor/live'),
    },
    { key: 'live', to: '/supervisor/live', label: 'Live', icon: Activity, planned: true },
    TAB_REPORTS,
    TAB_MESSAGES,
  ],
  admin: [
    { key: 'users', to: '/admin/users', label: 'Users', icon: Users },
    { key: 'templates', to: '/admin/templates', label: 'Templates', icon: FileCog },
    { key: 'requests', to: '/admin/requests', label: 'Requests', icon: UserPlus },
    TAB_ME,
  ],
};

// The tabs shown for a role: planned screens are left out.
export const tabsFor = (role) => (TABS[role] ?? []).filter((t) => !t.planned);

export const isTabActive = (tab, pathname) => (tab.match ? tab.match(pathname) : pathname === tab.to || pathname.startsWith(`${tab.to}/`));
