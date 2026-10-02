import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../api';
import { ROLE_HOME, useAuth } from '../auth/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const claims = await login(identifier.trim(), password);
      navigate(ROLE_HOME[claims.role], { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>SHMS</h1>
        <p className="muted">Shift Handover Management System</p>
        <label>
          Staff number or email
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="error">{error}</div>}
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">Prototype with synthetic data. Seeded accounts: KQ1001–KQ4003, KQ9001.</p>
      </form>
    </div>
  );
}
