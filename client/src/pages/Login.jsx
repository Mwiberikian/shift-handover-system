import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react';
import { errorMessage } from '../api';
import { ROLE_HOME, useAuth } from '../auth/AuthContext';
import { Button, Callout, Input } from '../components/ui';
import Brand from '../components/shell/Brand';

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
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-zinc-50 px-4 py-10">
      {/* Soft brand accent in the corner, kept faint so the page stays calm. */}
      <div aria-hidden className="pointer-events-none absolute -top-40 -right-40 size-[28rem] rounded-full bg-brand-red/[0.07] blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-48 -left-40 size-[26rem] rounded-full bg-zinc-300/30 blur-3xl" />

      <main className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Brand showName={false} size="lg" />
          <h1 className="mt-3 text-body font-medium text-zinc-600">Shift Handover Management System</h1>
        </div>

        <form
          onSubmit={submit}
          className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-pop"
        >
          <div aria-hidden className="h-1 bg-brand-red" />
          <div className="space-y-5 p-6 sm:p-8">
            <div>
              <h2 className="text-lg font-semibold text-brand-black">Sign in</h2>
              <p className="mt-0.5 text-zinc-600">Use your staff number or work email.</p>
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

        <p className="mt-6 text-center text-meta text-zinc-600">
          <ShieldCheck aria-hidden className="mr-1 inline size-3.5 -translate-y-px" />
          Prototype with synthetic data. Seeded accounts: KQ1001–KQ4003, KQ9001.
        </p>
      </main>
    </div>
  );
}
