import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth/AuthContext';

const ROLE_LABEL = {
  outgoing_staff: 'Outgoing staff',
  incoming_staff: 'Incoming staff',
  supervisor: 'Supervisor',
  admin: 'Administrator',
};

const NOTIFICATION_LABEL = {
  handover_submitted: 'Handover submitted',
  handover_acknowledged: 'Handover acknowledged',
  handover_queried: 'Query raised on your handover',
  handover_clarified: 'Clarification received',
  handover_escalated: 'Handover escalated',
  handover_closed: 'Handover closed',
};

function Notifications() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);

  const load = () => api.get('/notifications').then((r) => setItems(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const unread = items.filter((n) => !n.read_at).length;
  const markRead = async (n) => {
    if (!n.read_at) await api.post(`/notifications/${n.notification_id}/read`);
    load();
  };

  return (
    <div className="notif">
      <button type="button" className="link" onClick={() => setOpen(!open)}>
        Notifications{unread > 0 && <span className="count">{unread}</span>}
      </button>
      {open && (
        <ul className="notif-list">
          {items.length === 0 && <li className="muted">No notifications</li>}
          {items.map((n) => (
            <li key={n.notification_id} className={n.read_at ? 'read' : ''} onClick={() => markRead(n)}>
              <strong>{NOTIFICATION_LABEL[n.type] || n.type}</strong>
              <span className="muted"> · {n.department_code} · record {n.record_id?.slice(0, 8)} · now {n.record_status}</span>
              <div className="muted small">{new Date(n.sent_at).toLocaleString()}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Layout() {
  const { claims, profile, logout } = useAuth();
  if (!claims) return <Navigate to="/login" replace />;

  return (
    <>
      <header className="topbar">
        <div className="brand">SHMS <span className="muted">Shift Handover Management</span></div>
        <div className="who">
          <Notifications />
          <span>
            {profile?.full_name ?? '…'} · {ROLE_LABEL[claims.role]}
            {profile?.department_name && ` · ${profile.department_name}`}
          </span>
          <button type="button" onClick={logout}>Log out</button>
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </>
  );
}
