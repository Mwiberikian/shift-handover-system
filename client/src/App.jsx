import { Navigate, Route, Routes } from 'react-router-dom';
import { ROLE_HOME, useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import OutgoingPage from './pages/OutgoingPage';
import IncomingPage from './pages/IncomingPage';
import SupervisorPage from './pages/SupervisorPage';
import AdminPage from './pages/AdminPage';

// Only lets a user into the dashboard for the role in their JWT.
function RequireRole({ role, children }) {
  const { claims } = useAuth();
  if (!claims) return <Navigate to="/login" replace />;
  if (claims.role !== role) return <Navigate to={ROLE_HOME[claims.role]} replace />;
  return children;
}

export default function App() {
  const { claims } = useAuth();
  const home = claims ? ROLE_HOME[claims.role] : '/login';

  return (
    <Routes>
      <Route path="/login" element={claims ? <Navigate to={home} replace /> : <Login />} />
      <Route element={<Layout />}>
        <Route path="/outgoing" element={<RequireRole role="outgoing_staff"><OutgoingPage /></RequireRole>} />
        <Route path="/incoming" element={<RequireRole role="incoming_staff"><IncomingPage /></RequireRole>} />
        <Route path="/supervisor" element={<RequireRole role="supervisor"><SupervisorPage /></RequireRole>} />
        <Route path="/admin" element={<RequireRole role="admin"><AdminPage /></RequireRole>} />
      </Route>
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}
