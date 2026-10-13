import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LogOut } from 'lucide-react';
import api, { errorMessage } from '../api';
import { ROLE_HOME, useAuth } from '../auth/AuthContext';
import AuthShell from '../components/shell/AuthShell';
import { Button, Callout, Input } from '../components/ui';
import useAction from '../lib/useAction';

const MIN = 10;
const MAX = 72;

// NFR-05: an account created from an access request signs in with a temporary
// password and lands here. Until the password is changed the API refuses
// everything else, and the app shows nothing else.
export default function ChangePassword() {
  const { claims, applySession, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState(null);
  const [run, busy] = useAction();
  const forced = Boolean(claims?.pwd_change);

  const mismatch = form.confirm && form.next !== form.confirm;
  const ready = form.current && form.next.length >= MIN && form.next === form.confirm;

  const submit = (e) => {
    e.preventDefault();
    setError(null);
    run(async () => {
      try {
        const { data } = await api.post('/auth/change-password', { current_password: form.current, new_password: form.next });
        const next = applySession(data);
        navigate(ROLE_HOME[next.role], { replace: true });
      } catch (err) {
        setError(errorMessage(err));
        throw err;
      }
    }, 'Password changed');
  };

  return (
    <AuthShell as="form" onSubmit={submit}>
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-fg"><KeyRound aria-hidden className="size-5" />Choose a new password</h1>
        <p className="mt-0.5 text-ink-700">
          {forced
            ? 'You signed in with a temporary password. Choose your own before you continue.'
            : 'Enter your current password and a new one.'}
        </p>
      </div>

      {error && <Callout tone="danger" title="Password not changed">{error}</Callout>}

      <Input
        label={forced ? 'Temporary password' : 'Current password'}
        type="password"
        autoComplete="current-password"
        value={form.current}
        onChange={(e) => setForm({ ...form, current: e.target.value })}
        autoFocus
        required
      />
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`${MIN} to ${MAX} characters, different from the current one.`}
        minLength={MIN}
        maxLength={MAX}
        value={form.next}
        onChange={(e) => setForm({ ...form, next: e.target.value })}
        required
      />
      <Input
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        maxLength={MAX}
        value={form.confirm}
        onChange={(e) => setForm({ ...form, confirm: e.target.value })}
        error={mismatch ? 'The passwords do not match' : undefined}
        required
      />

      <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!ready} className="w-full">
        Change password
      </Button>
      {forced && (
        <Button variant="ghost" icon={LogOut} onClick={logout} className="w-full">Sign out instead</Button>
      )}
    </AuthShell>
  );
}
