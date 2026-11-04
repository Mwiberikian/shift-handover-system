import { useState } from 'react';
import { FingerprintPattern } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { isPasskeyCancel, signInWithPasskey, usePasskeysAvailable } from '../../lib/passkeys';
import { Button, Callout } from '../ui';
import { useGoogleClientId } from './GoogleButton';

const FAILED = 'Passkey sign-in failed. Use your password or try again.';

// "Sign in with a passkey", for the login page. Renders nothing unless this
// browser and the server both support passkeys. `onSignedIn` gets the session
// claims. Its messages stay here, so a passkey problem doesn't mark the password
// fields as wrong.
export default function PasskeyButton({ onSignedIn }) {
  const available = usePasskeysAvailable();
  const googleClientId = useGoogleClientId();
  const { applySession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!available) return null;

  const signIn = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      onSignedIn(applySession(await signInWithPasskey()));
    } catch (err) {
      if (isPasskeyCancel(err)) setNotice('Passkey sign-in was cancelled. You can try again or use your password.');
      else setError(err.response?.data?.error ?? FAILED);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Google's button brings its own divider; without it this one is needed. */}
      {googleClientId === null && (
        <div className="flex items-center gap-3 text-meta text-ink-600" aria-hidden>
          <span className="h-px flex-1 bg-ink-900/10" /> or <span className="h-px flex-1 bg-ink-900/10" />
        </div>
      )}
      <Button variant="secondary" size="lg" shape="pill" icon={FingerprintPattern} loading={busy} onClick={signIn} className="w-full">
        Sign in with a passkey
      </Button>
      {notice && <Callout tone="info">{notice}</Callout>}
      {error && <Callout tone="danger">{error}</Callout>}
    </div>
  );
}
