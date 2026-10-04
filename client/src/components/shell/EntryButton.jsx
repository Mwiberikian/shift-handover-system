import { LayoutDashboard, LogIn } from 'lucide-react';
import { ROLE_HOME, useAuth } from '../../auth/AuthContext';
import { ButtonLink } from '../ui';

// Primary call to action on public pages: "Log In" when signed out, "Go to
// dashboard" (the user's role home) when signed in.
export default function EntryButton({ size = 'md', className }) {
  const { claims } = useAuth();
  return claims
    ? <ButtonLink to={ROLE_HOME[claims.role]} variant="primary" size={size} icon={LayoutDashboard} className={className}>
        <span className="sm:hidden">Dashboard</span>
        <span className="hidden sm:inline">Go to dashboard</span>
      </ButtonLink>
    : <ButtonLink to="/login" variant="primary" size={size} icon={LogIn} className={className}>Log In</ButtonLink>;
}
