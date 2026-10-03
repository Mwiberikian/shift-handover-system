import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react';
import { errorMessage } from '../api';
import { ROLE_HOME, useAuth } from '../auth/AuthContext';
import { Button, Callout, Input } from '../components/ui';
import Brand from '../components/shell/Brand';
import runwayUrl from '../assets/images/runway-dusk.webp';

export default function Login() {
  const { login } = useAuth();
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

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-brand-black px-4 py-10">
      {/* Runway photo behind a dark gradient; the card is frosted glass over it. */}
      <img src={runwayUrl} alt="" aria-hidden className="absolute inset-0 size-full object-cover" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-brand-black/55 via-brand-black/25 to-brand-black/70" />

      <main className="relative w-full max-w-sm">
        <form
          onSubmit={submit}
          className="glass-light overflow-hidden rounded-2xl shadow-pop"
        >
          <div aria-hidden className="h-1 bg-brand-red" />
          <div className="space-y-5 p-6 sm:p-8">
            <div className="flex flex-col items-center gap-2 border-b border-zinc-900/10 pb-5 text-center">
              <Brand showName={false} size="lg" />
              <h1 className="text-body font-medium text-zinc-700">Shift Handover Management System</h1>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-brand-black">Sign in</h2>
              <p className="mt-0.5 text-zinc-700">Use your staff number or work email.</p>
            </div>

            {error && <Callout tone="danger" title="Sign-in failed">{error}</Callout>}

            <Input
              label="Staff number or email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              placeholder="e.g. KQ1001"
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
                className="absolute top-[30px] right-1.5 grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
              >
                {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
              </button>
            </div>

            <Button type="submit" variant="primary" size="lg" icon={LogIn} loading={busy} className="w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
        </form>

        <p className="mt-6 text-center text-meta text-zinc-200 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
          <ShieldCheck aria-hidden className="mr-1 inline size-3.5 -translate-y-px" />
          Prototype with synthetic data. Seeded accounts: KQ1001–KQ4003, KQ9001.
        </p>
      </main>
    </div>
  );
}
