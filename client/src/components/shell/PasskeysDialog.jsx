import { useEffect, useState } from 'react';
import { FingerprintPattern, Pencil, Trash2 } from 'lucide-react';
import api, { errorMessage } from '../../api';
import { formatEAT } from '../../lib/format';
import {
  addPasskey, defaultPasskeyLabel, isPasskeyCancel, isPasskeyDuplicate,
} from '../../lib/passkeys';
import { toast } from '../../lib/toast';
import useAction from '../../lib/useAction';
import {
  Button, Callout, ConfirmDialog, Input, Modal,
} from '../ui';

const MAX_PASSKEYS = 10;
const MAX_LABEL = 60;

function PasskeyRow({ passkey, onRename, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(passkey.label);
  const [run, busy] = useAction();
  const trimmed = label.trim();

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      await onRename(passkey.id, trimmed);
      setEditing(false);
    }, 'Passkey renamed');
  };

  if (editing) {
    return (
      <li className="py-3">
        <form onSubmit={save} className="space-y-2">
          <Input label="Passkey name" value={label} maxLength={MAX_LABEL} autoFocus onChange={(e) => setLabel(e.target.value)} required />
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => { setLabel(passkey.label); setEditing(false); }} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!trimmed}>Save</Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-40">
        <p className="font-medium break-words text-fg">{passkey.label}</p>
        <p className="text-meta text-ink-600">Added {formatEAT(passkey.created_at)}</p>
        <p className="text-meta text-ink-600">{passkey.last_used_at ? `Last used ${formatEAT(passkey.last_used_at)}` : 'Not used yet'}</p>
      </div>
      <div className="flex gap-2">
        <Button icon={Pencil} onClick={() => setEditing(true)} aria-label={`Rename ${passkey.label}`}>Rename</Button>
        <Button variant="danger" icon={Trash2} onClick={() => onRemove(passkey)} aria-label={`Remove ${passkey.label}`}>Remove</Button>
      </div>
    </li>
  );
}

// The Passkeys card: add, rename and remove your own passkeys. Opened from the
// account menu and the phone's Me sheet. `onAdded` runs after a passkey is added.
export default function PasskeysDialog({ open, onClose, onAdded }) {
  const [passkeys, setPasskeys] = useState(null);
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState(null);
  const [runRemove, removeBusy] = useAction();

  useEffect(() => {
    if (!open) return;
    setPasskeys(null);
    setLabel(defaultPasskeyLabel());
    setError('');
    setNotice('');
    api.get('/auth/passkeys').then((r) => setPasskeys(r.data)).catch((err) => {
      setPasskeys([]);
      setError(errorMessage(err));
    });
  }, [open]);

  const add = async (e) => {
    e.preventDefault();
    setAdding(true);
    setError('');
    setNotice('');
    try {
      const created = await addPasskey(label.trim());
      setPasskeys((list) => [created, ...(list ?? [])]);
      setLabel(defaultPasskeyLabel());
      toast.success('Passkey added');
      onAdded?.();
    } catch (err) {
      if (isPasskeyCancel(err)) setNotice('Adding the passkey was cancelled. Nothing was changed.');
      else if (isPasskeyDuplicate(err)) setError('This device already has a passkey for your account.');
      else setError(err.response ? errorMessage(err) : 'The passkey could not be added. Please try again.');
    } finally {
      setAdding(false);
    }
  };

  const rename = async (id, next) => {
    const { data } = await api.patch(`/auth/passkeys/${id}`, { label: next });
    setPasskeys((list) => list.map((p) => (p.id === id ? data : p)));
  };

  const remove = () => runRemove(async () => {
    await api.delete(`/auth/passkeys/${removing.id}`);
    setPasskeys((list) => list.filter((p) => p.id !== removing.id));
    setRemoving(null);
  }, 'Passkey removed');

  const atLimit = (passkeys?.length ?? 0) >= MAX_PASSKEYS;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Passkeys"
      description="Sign in with your fingerprint, face or device PIN, which stay on your device."
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4 text-body">
        {notice && <Callout tone="info">{notice}</Callout>}
        {error && <Callout tone="danger">{error}</Callout>}

        {passkeys === null ? <p className="text-ink-600">Loading…</p> : (
          <>
            {passkeys.length === 0
              ? <p className="text-ink-700">You have no passkeys yet.</p>
              : (
                <ul className="divide-y divide-ink-100">
                  {passkeys.map((p) => <PasskeyRow key={p.id} passkey={p} onRename={rename} onRemove={setRemoving} />)}
                </ul>
              )}

            {atLimit ? <p className="text-meta text-ink-600">You have reached the limit of {MAX_PASSKEYS} passkeys. Remove one to add another.</p> : (
              <form onSubmit={add} className="flex flex-wrap items-end gap-2">
                <Input
                  label="Name for the new passkey"
                  className="min-w-0 flex-1 basis-48"
                  value={label}
                  maxLength={MAX_LABEL}
                  onChange={(e) => setLabel(e.target.value)}
                  required
                />
                <Button type="submit" variant="primary" icon={FingerprintPattern} loading={adding} disabled={!label.trim()}>Add a passkey</Button>
              </form>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        loading={removeBusy}
        tone="danger"
        title="Remove this passkey?"
        confirmLabel="Remove"
        message={<p>“{removing?.label}” will no longer sign you in. You can still use your password.</p>}
      />
    </Modal>
  );
}
