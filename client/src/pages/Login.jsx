import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { errorMessage } from '../api';
import { ROLE_HOME, useAuth } from '../auth/AuthContext';
import { Button, Callout, Input } from '../components/ui';
import AuthShell, { CardLink } from '../components/shell/AuthShell';
import GoogleButton from '../components/shell/GoogleButton';
import { toast } from '../lib/toast';

export default function Login() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const claims = await login(identifier.trim(), password);
      navigate(ROLE_HOME[claims.role], { replace: true });
    } catch (err) {
      setError(err.response?.status === 401 ? 'The staff number/email or password is incorrect.' : errorMessage(err));
      setPassword('');
      passwordRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  // Google only signs in to an existing account. With no account, the verified
  // name and email are carried to the access-request form.
  const google = async (credential) => {
    setError('');
    try {
      const claims = await loginWithGoogle(credential);
      navigate(ROLE_HOME[claims.role], { replace: true });
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 404 && data?.code === 'no_account') {
        toast.info('No account uses that Google address yet', { description: 'Send a request and an administrator will set up your access.' });
        navigate('/request-access', { state: { google: { name: data.name, email: data.email } } });
      } else {
        setError(data?.error ?? errorMessage(err));
      }
    }
  };

  return (
    <AuthShell
      as="form"
      onSubmit={submit}
      footer={<p className="text-ink-700">Need an account? <CardLink to="/request-access">Request access</CardLink></p>}
    >
      <div>
        <h1 className="text-lg font-semibold text-fg">Sign in</h1>
        <p className="mt-0.5 text-ink-700">Use your staff number or work email.</p>
      </div>

      {error && <Callout tone="danger" title="Sign-in failed">{error}</Callout>}

      <Input
        label="Staff number or email"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        autoComplete="username"
        autoFocus
        required
        error={!!error}
      />

      <div className="relative">
        <Input
          ref={passwordRef}
          label="Password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          inputClassName="pr-10"
          error={!!error}
        />
        <button
          type="button"
          onClick={() => setShowPassword((s) => !s)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          aria-pressed={showPassword}
          className="absolute top-[30px] right-1.5 grid size-7 place-items-center rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-800"
        >
          {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        </button>
      </div>

      <Button type="submit" variant="primary" size="lg" icon={LogIn} loading={busy} className="w-full">
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>

      <GoogleButton onCredential={google} />
    </AuthShell>
  );
}
