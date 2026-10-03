import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { ROLE_HOME, useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import OutgoingPage from './pages/OutgoingPage';
import IncomingPage from './pages/IncomingPage';
import SupervisorPage from './pages/SupervisorPage';
import AdminPage from './pages/AdminPage';

// Only lets a user into the dashboard for the role in their JWT.
function RequireRole({ role }) {
  const { claims } = useAuth();
  if (!claims) return <Navigate to="/login" replace />;
  if (claims.role !== role) return <Navigate to={ROLE_HOME[claims.role]} replace />;
  return <Outlet />;
}

export default function App() {
  const { claims } = useAuth();
  const home = claims ? ROLE_HOME[claims.role] : '/';

  return (
    <Routes>
      <Route path="/" element={claims ? <Navigate to={home} replace /> : <Landing />} />
      <Route path="/login" element={claims ? <Navigate to={home} replace /> : <Login />} />
      <Route element={<Layout />}>
        <Route path="/outgoing" element={<RequireRole role="outgoing_staff" />}>
          <Route index element={<OutgoingPage view="current" />} />
          <Route path="history" element={<OutgoingPage view="history" />} />
        </Route>
        <Route path="/incoming" element={<RequireRole role="incoming_staff" />}>
          <Route index element={<IncomingPage view="pending" />} />
          <Route path="history" element={<IncomingPage view="all" />} />
        </Route>
        <Route path="/supervisor" element={<RequireRole role="supervisor" />}>
          <Route index element={<SupervisorPage view="overview" />} />
          <Route path="queue" element={<SupervisorPage view="queue" />} />
          <Route path="escalated" element={<SupervisorPage view="escalated" />} />
          <Route path="search" element={<SupervisorPage view="search" />} />
        </Route>
        <Route path="/admin" element={<RequireRole role="admin" />}>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<AdminPage view="users" />} />
          <Route path="templates" element={<AdminPage view="templates" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}
