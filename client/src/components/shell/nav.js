import {
  AlertTriangle, ClipboardList, FileCog, History, Inbox, LayoutDashboard, ListChecks, Search, UserPlus, Users,
} from 'lucide-react';

// Sidebar links per role. Each role only ever sees its own entries.
export const NAV = {
  outgoing_staff: [
    { to: '/outgoing', end: true, label: 'Current handover', icon: ClipboardList },
    { to: '/outgoing/history', label: 'My handovers', icon: History },
  ],
  incoming_staff: [
    { to: '/incoming', end: true, label: 'Awaiting action', icon: Inbox },
    { to: '/incoming/history', label: 'All handovers', icon: History },
  ],
  supervisor: [
    { to: '/supervisor', end: true, label: 'Overview', icon: LayoutDashboard },
    { to: '/supervisor/queue', label: 'Review queue', icon: ListChecks },
    { to: '/supervisor/escalated', label: 'Escalated', icon: AlertTriangle },
    { to: '/supervisor/search', label: 'Search', icon: Search },
  ],
  admin: [
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/admin/requests', label: 'Access requests', icon: UserPlus },
    { to: '/admin/templates', label: 'Templates', icon: FileCog },
  ],
};
