import { useEffect, useState } from 'react';
import { FingerprintPattern } from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { dismissPasskeyOffer, passkeyOfferPending, usePasskeysAvailable } from '../../lib/passkeys';
import { Button, Callout } from '../ui';
import PasskeysDialog from './PasskeysDialog';

// Offered after a password login, on a device that supports passkeys, to someone
// with none, until they dismiss it or add one. Not during a temporary password:
// the API refuses passkey calls until that has been changed.
export default function PasskeyPrompt() {
  const { claims } = useAuth();
  const available = usePasskeysAvailable();
  const [show, setShow] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const userId = claims?.user_id;
  const waiting = claims?.pwd_change;

  useEffect(() => {
    if (!available || waiting || !userId || !passkeyOfferPending(userId)) return undefined;
    let live = true;
    api.get('/auth/passkeys')
      .then((r) => { if (live && Array.isArray(r.data) && r.data.length === 0) setShow(true); })
      .catch(() => {});
    return () => { live = false; };
  }, [available, waiting, userId]);

  const dismiss = () => {
    dismissPasskeyOffer(userId);
    setShow(false);
  };

  return (
    <>
      {show && (
        <div className="mx-auto max-w-screen-2xl px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
          <Callout tone="info" icon={FingerprintPattern} title="Sign in faster with a passkey">
            <p>Use your fingerprint, face or device PIN next time. They stay on this device.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setDialogOpen(true)}>Add a passkey</Button>
              <Button variant="ghost" onClick={dismiss}>Not now</Button>
            </div>
          </Callout>
        </div>
      )}
      <PasskeysDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onAdded={dismiss} />
    </>
  );
}
