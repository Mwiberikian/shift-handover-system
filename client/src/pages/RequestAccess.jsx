import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BadgeCheck, CheckCircle2, Send } from 'lucide-react';
import api, { errorMessage } from '../api';
import AuthShell, { CardLink } from '../components/shell/AuthShell';
import GoogleButton, { useGoogleClientId } from '../components/shell/GoogleButton';
import {
  Button, ButtonLink, Callout, Input, Select, Textarea,
} from '../components/ui';

const EMPTY = { full_name: '', email: '', staff_number: '', requested_department_code: '', note: '' };

// Public form. Submitting records a request for an administrator to review;
// it does not create an account.
export default function RequestAccess() {
  // Arriving from a Google sign-in with no account: name and email are already
  // verified by the server, so the email is locked.
  const fromGoogle = useLocation().state?.google;
  const [form, setForm] = useState(fromGoogle ? { ...EMPTY, full_name: fromGoogle.name ?? '', email: fromGoogle.email ?? '' } : EMPTY);
  const [verifiedEmail, setVerifiedEmail] = useState(fromGoogle?.email ?? null);
  const googleEnabled = useGoogleClientId();
  const [departments, setDepartments] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    api.get('/access-requests/departments').then((r) => setDepartments(r.data)).catch(() => setError('Departments could not be loaded. Please refresh the page.'));
  }, []);

  const set = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value });
    if (fieldErrors[k]) setFieldErrors({ ...fieldErrors, [k]: undefined });
  };

  const handleGoogle = async (credential) => {
    setError('');
    try {
      const { data } = await api.post('/auth/google/profile', { credential });
      setForm((f) => ({ ...f, full_name: f.full_name || data.name, email: data.email }));
      setVerifiedEmail(data.email);
      setFieldErrors({});
    } catch (err) {
      setError(err.response?.data?.error ?? errorMessage(err));
    }
  };

  const clearGoogle = () => {
    setVerifiedEmail(null);
    setForm((f) => ({ ...f, email: '' }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      await api.post('/access-requests', form);
      setSent(true);
    } catch (err) {
      const details = err.response?.data?.details;
      if (err.response?.status === 400 && Array.isArray(details)) {
        setFieldErrors(Object.fromEntries(details.map((d) => [d.field, d.message])));
        setError('Please correct the highlighted fields.');
      } else {
        setError(err.response?.data?.error ?? errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell wide>
        <div role="status" className="flex flex-col items-center gap-3 py-2 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-status-green-soft text-status-green ring-1 ring-status-green-line ring-inset">
            <CheckCircle2 aria-hidden className="size-6" />
          </span>
          <h1 className="text-lg font-semibold text-fg">Your request has been sent to an administrator</h1>
          <p className="max-w-sm text-ink-700">
            An administrator will review it and assign your role and department. Once approved, they will give you
            your sign-in details. There is no need to submit another request.
          </p>
          <ButtonLink to="/login" variant="primary" className="mt-2">Back to sign in</ButtonLink>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      as="form"
      wide
      onSubmit={submit}
      noValidate
      footer={<p className="text-ink-700">Already have an account? <CardLink to="/login">Sign in</CardLink></p>}
    >
      <div>
        <h1 className="text-lg font-semibold text-fg">Request access</h1>
        <p className="mt-0.5 text-ink-700">
          Tell us who you are and where you work. An administrator reviews every request and decides your access.
        </p>
      </div>

      {error && <Callout tone="danger" title="Request not sent">{error}</Callout>}

      {verifiedEmail ? (
        <Callout tone="success" icon={BadgeCheck} title="Verified with Google" action={<Button size="sm" variant="ghost" onClick={clearGoogle}>Use a different address</Button>}>
          <span className="break-all">{verifiedEmail}</span>
        </Callout>
      ) : googleEnabled && (
        <div className="space-y-4">
          <GoogleButton onCredential={handleGoogle} divider={false} />
          <div className="flex items-center gap-3 text-meta text-ink-600" aria-hidden>
            <span className="h-px flex-1 bg-ink-900/10" /> or fill in your details <span className="h-px flex-1 bg-ink-900/10" />
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Full name" required autoComplete="name" value={form.full_name} onChange={set('full_name')} error={fieldErrors.full_name} className="sm:col-span-2" autoFocus />
        <Input
          label="Work email"
          type="email"
          required
          autoComplete="email"
          value={form.email}
          onChange={set('email')}
          readOnly={!!verifiedEmail}
          error={fieldErrors.email}
          hint={verifiedEmail ? 'Verified with Google' : undefined}
        />
        <Input label="Staff number" value={form.staff_number} onChange={set('staff_number')} error={fieldErrors.staff_number} hint="If you know it." />
        <Select
          label="Department"
          required
          className="sm:col-span-2"
          value={form.requested_department_code}
          onChange={set('requested_department_code')}
          placeholder="Select your department…"
          options={departments.map((d) => ({ value: d.code, label: d.name }))}
          error={fieldErrors.requested_department_code}
        />
        <Textarea
          label="Note for the administrator"
          className="sm:col-span-2"
          rows={3}
          maxLength={1000}
          value={form.note}
          onChange={set('note')}
          error={fieldErrors.note}
          hint="Your role, start date or line manager helps them place you correctly."
        />
      </div>

      <Button type="submit" variant="primary" size="lg" icon={Send} loading={busy} className="w-full">
        {busy ? 'Sending request…' : 'Send request'}
      </Button>
    </AuthShell>
  );
}
