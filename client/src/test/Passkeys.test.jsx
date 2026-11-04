// Passkey UI with @simplewebauthn/browser mocked. The server side is in
// server/tests/auth.passkeys.test.js.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import {
  beforeEach, describe, expect, test, vi,
} from 'vitest';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import api, { tokenStore } from '../api';
import { ROLE_HOME } from '../auth/AuthContext';
import PasskeyPrompt from '../components/shell/PasskeyPrompt';
import PasskeysDialog from '../components/shell/PasskeysDialog';
import UserMenu from '../components/shell/UserMenu';
import { defaultPasskeyLabel, markPasswordLogin, resetPasskeyConfigForTests } from '../lib/passkeys';
import Login from '../pages/Login';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

vi.mock('@react-oauth/google', () => ({
  GoogleOAuthProvider: ({ children }) => children,
  GoogleLogin: () => <button type="button">Continue with Google</button>,
}));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(),
    },
  };
});

const named = (name, message = 'no') => Object.assign(new Error(message), { name });
const BUTTON = { name: /sign in with a passkey/i };
const PASSKEY = {
  id: 'pk-1', label: 'Work laptop', created_at: '2026-10-13T20:00:00Z', last_used_at: null, device_type: 'multiDevice',
};
const USED = {
  id: 'pk-2', label: 'My phone', created_at: '2026-10-01T05:00:00Z', last_used_at: '2026-10-13T20:30:00Z', device_type: 'multiDevice',
};

// Answers GETs by path; `enabled` is what the server says about passkeys.
function serve({ enabled = true, passkeys = [] } = {}) {
  api.get.mockImplementation(async (url) => {
    if (url === '/auth/passkeys/config') return { data: { passkeys: enabled } };
    if (url === '/auth/passkeys') return { data: passkeys };
    if (url === '/auth/google/config') return { data: { client_id: null } };
    return { data: { full_name: 'Brian Kamau', email: 'brian@shms.example', email_notifications: true } };
  });
}

function loginCeremony(role = 'supervisor', extra = {}) {
  api.post.mockImplementation(async (url) => {
    if (url === '/auth/passkeys/login/options') return { data: { challenge_id: 'ch-1', options: { challenge: 'abc' } } };
    if (url === '/auth/passkeys/login/verify') return { data: { token: fakeToken(role, extra), user: { role } } };
    throw new Error(`unexpected POST ${url}`);
  });
  startAuthentication.mockResolvedValue({ id: 'cred-1' });
}

function renderLogin() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<p>change password screen</p>} />
      {Object.entries(ROLE_HOME).map(([role, path]) => <Route key={role} path={path} element={<p>{role} home</p>} />)}
    </Routes>,
    { route: '/login' },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  resetPasskeyConfigForTests();
  localStorage.clear();
  browserSupportsWebAuthn.mockReturnValue(true);
  serve();
});

describe('hidden unless supported and enabled', () => {
  test('an unsupported browser sees no passkey button and asks the server nothing about passkeys', async () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    renderLogin();
    await screen.findByRole('heading', { name: /welcome back/i });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/google/config'));
    expect(screen.queryByRole('button', BUTTON)).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/auth/passkeys/config');
    expect(screen.getByRole('button', { name: /^log in/i })).toBeInTheDocument();
  });

  test('a server with passkeys off shows no passkey button', async () => {
    serve({ enabled: false });
    renderLogin();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/passkeys/config'));
    await Promise.resolve();
    expect(screen.queryByRole('button', BUTTON)).not.toBeInTheDocument();
  });

  test('a failed config check hides the button', async () => {
    api.get.mockRejectedValue(new Error('offline'));
    renderLogin();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/passkeys/config'));
    expect(screen.queryByRole('button', BUTTON)).not.toBeInTheDocument();
  });

  test.each([
    ['unsupported', () => browserSupportsWebAuthn.mockReturnValue(false)],
    ['disabled', () => serve({ enabled: false })],
  ])('the account menu has no Passkeys row when %s', async (_, arrange) => {
    arrange();
    tokenStore.set(fakeToken('incoming_staff'));
    const user = userEvent.setup();
    renderWithProviders(<UserMenu />);
    await user.click(await screen.findByRole('button', { name: /account menu/i }));
    await screen.findByRole('link', { name: 'Change password' });
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: 'Passkeys' })).not.toBeInTheDocument();
  });

  test('no prompt either', async () => {
    serve({ enabled: false });
    tokenStore.set(fakeToken('incoming_staff'));
    markPasswordLogin();
    renderWithProviders(<PasskeyPrompt />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/passkeys/config'));
    await Promise.resolve();
    expect(screen.queryByText(/sign in faster/i)).not.toBeInTheDocument();
  });
});

describe('sign-in', () => {
  test.each(Object.entries(ROLE_HOME))('%s lands on %s, with the token stored', async (role) => {
    loginCeremony(role);
    const user = userEvent.setup();
    renderLogin();
    await user.click(await screen.findByRole('button', BUTTON));

    expect(await screen.findByText(`${role} home`)).toBeInTheDocument();
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'abc' } });
    expect(api.post).toHaveBeenLastCalledWith('/auth/passkeys/login/verify', { challenge_id: 'ch-1', response: { id: 'cred-1' } });
    expect(tokenStore.get()).toBeTruthy();
  });

  test('a temporary password still goes to the change-password screen', async () => {
    loginCeremony('supervisor', { pwd_change: true });
    const user = userEvent.setup();
    renderLogin();
    await user.click(await screen.findByRole('button', BUTTON));
    expect(await screen.findByText('change password screen')).toBeInTheDocument();
  });

  test('does not ask for conditional-UI autofill', async () => {
    loginCeremony();
    const user = userEvent.setup();
    renderLogin();
    await user.click(await screen.findByRole('button', BUTTON));
    await screen.findByText('supervisor home');
    expect(startAuthentication.mock.calls[0][0].useBrowserAutofill).toBeUndefined();
    expect(screen.queryByRole('button', BUTTON)).not.toBeInTheDocument();
  });

  test.each([['NotAllowedError'], ['AbortError']])('%s shows a friendly message, no alert, and the password form still works', async (name) => {
    loginCeremony('outgoing_staff');
    startAuthentication.mockRejectedValue(named(name));
    const user = userEvent.setup();
    renderLogin();
    await user.click(await screen.findByRole('button', BUTTON));

    expect(await screen.findByRole('status')).toHaveTextContent(/cancelled/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(tokenStore.get()).toBeNull();
    expect(screen.getByRole('button', BUTTON)).toBeEnabled();

    api.post.mockResolvedValue({ data: { token: fakeToken('outgoing_staff'), user: { role: 'outgoing_staff' } } });
    await user.type(screen.getByLabelText(/staff number or email/i), 'KQ1001');
    await user.type(screen.getByLabelText(/^password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /^log in/i }));
    expect(await screen.findByText('outgoing_staff home')).toBeInTheDocument();
  });

  test("the server's refusal shows in role=alert and leaves the password fields unmarked", async () => {
    loginCeremony();
    const message = 'Passkey sign-in failed. Use your password or try again.';
    api.post.mockImplementation(async (url) => {
      if (url.endsWith('/options')) return { data: { challenge_id: 'ch-1', options: {} } };
      throw Object.assign(new Error('x'), { response: { status: 400, data: { error: message } } });
    });
    const user = userEvent.setup();
    renderLogin();
    await user.click(await screen.findByRole('button', BUTTON));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText(/^password/i)).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  });

  test('a browser failure gets the generic message, not its own text', async () => {
    loginCeremony();
    startAuthentication.mockRejectedValue(named('SecurityError', 'internal detail'));
    const user = userEvent.setup();
    renderLogin();
    await user.click(await screen.findByRole('button', BUTTON));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/passkey sign-in failed/i);
    expect(alert).not.toHaveTextContent('internal detail');
  });
});

describe('Passkeys card', () => {
  const open = () => {
    tokenStore.set(fakeToken('incoming_staff'));
    return renderWithProviders(<PasskeysDialog open onClose={() => {}} />);
  };

  test('explains that biometrics stay on the device, and lists passkeys with their dates', async () => {
    serve({ passkeys: [PASSKEY, USED] });
    open();
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(screen.getByText(/fingerprint, face or device PIN, which stay on your device/i)).toBeInTheDocument();
    expect(within(items[0]).getByText('Work laptop')).toBeInTheDocument();
    expect(within(items[0]).getByText('Added 2026-10-13 23:00 EAT')).toBeInTheDocument();
    expect(within(items[0]).getByText('Not used yet')).toBeInTheDocument();
    expect(within(items[1]).getByText('Last used 2026-10-13 23:30 EAT')).toBeInTheDocument();
  });

  test('adds a passkey with a default name from the device, which can be changed', async () => {
    api.post.mockImplementation(async (url) => (url.endsWith('/options')
      ? { data: { challenge_id: 'ch-2', options: { challenge: 'xyz' } } }
      : { data: PASSKEY }));
    startRegistration.mockResolvedValue({ id: 'cred-2' });
    const user = userEvent.setup();
    open();

    const name = await screen.findByLabelText(/name for the new passkey/i);
    expect(name).toHaveValue(defaultPasskeyLabel());
    await user.clear(name);
    await user.type(name, 'Work laptop');
    await user.click(screen.getByRole('button', { name: 'Add a passkey' }));

    expect(await screen.findByText('Work laptop')).toBeInTheDocument();
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'xyz' } });
    expect(api.post).toHaveBeenLastCalledWith('/auth/passkeys/register/verify', { challenge_id: 'ch-2', response: { id: 'cred-2' }, label: 'Work laptop' });
  });

  test('cancelling the prompt is a friendly message and changes nothing', async () => {
    api.post.mockResolvedValue({ data: { challenge_id: 'ch-2', options: {} } });
    startRegistration.mockRejectedValue(named('NotAllowedError'));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/cancelled/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  test('a device that already has a passkey is told so', async () => {
    api.post.mockResolvedValue({ data: { challenge_id: 'ch-2', options: {} } });
    startRegistration.mockRejectedValue(named('InvalidStateError'));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already has a passkey/i);
  });

  test('at the limit of 10, offers no add', async () => {
    serve({ passkeys: Array.from({ length: 10 }, (_, i) => ({ ...PASSKEY, id: `pk-${i}` })) });
    open();
    expect(await screen.findByText(/limit of 10 passkeys/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a passkey' })).not.toBeInTheDocument();
  });

  test('renames', async () => {
    serve({ passkeys: [PASSKEY] });
    api.patch.mockResolvedValue({ data: { ...PASSKEY, label: 'Desk key' } });
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Rename Work laptop' }));
    const input = screen.getByLabelText(/passkey name/i);
    await user.clear(input);
    await user.type(input, 'Desk key');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Desk key')).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith('/auth/passkeys/pk-1', { label: 'Desk key' });
  });

  test('Cancel in the confirm dialog keeps the passkey', async () => {
    serve({ passkeys: [PASSKEY] });
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('button', { name: 'Remove Work laptop' }));
    const confirm = await screen.findByRole('dialog', { name: /remove this passkey/i });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /remove this passkey/i })).not.toBeInTheDocument());
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByText('Work laptop')).toBeInTheDocument();
  });

  test('removes after the confirm dialog', async () => {
    serve({ passkeys: [PASSKEY] });
    api.delete.mockResolvedValue({});
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('button', { name: 'Remove Work laptop' }));
    expect(api.delete).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('dialog', { name: /remove this passkey/i });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));

    expect(api.delete).toHaveBeenCalledWith('/auth/passkeys/pk-1');
    expect(await screen.findByText(/no passkeys yet/i)).toBeInTheDocument();
  });

  test('opens from the account menu', async () => {
    tokenStore.set(fakeToken('incoming_staff'));
    serve({ passkeys: [PASSKEY] });
    const user = userEvent.setup();
    renderWithProviders(<UserMenu />);
    await user.click(await screen.findByRole('button', { name: /account menu/i }));
    await user.click(await screen.findByRole('button', { name: 'Passkeys' }));
    expect(await screen.findByText('Work laptop')).toBeInTheDocument();
  });

  test.each([
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone passkey'],
    ['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Windows passkey'],
    ['Android', 'Mozilla/5.0 (Linux; Android 14)', 'Android passkey'],
    ['unknown', 'SomeBrowser/1.0', 'My passkey'],
  ])('the default name on %s', (_, ua, expected) => {
    expect(defaultPasskeyLabel(ua)).toBe(expected);
  });
});

describe('prompt after a password login', () => {
  const USER_ID = 'user-incoming_staff';
  const render = (role = 'incoming_staff', extra = {}) => {
    tokenStore.set(fakeToken(role, extra));
    return renderWithProviders(<PasskeyPrompt />);
  };

  test('offers a passkey to someone with none, and dismissal is remembered', async () => {
    markPasswordLogin();
    const user = userEvent.setup();
    const { unmount } = render();

    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(/sign in faster/i)).not.toBeInTheDocument();
    expect(localStorage.getItem(`shms_passkey_prompt_dismissed:${USER_ID}`)).toBe('1');
    unmount();

    api.get.mockClear();
    render();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByText(/sign in faster/i)).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/auth/passkeys');
  });

  test('adding a passkey from the prompt ends the offer', async () => {
    markPasswordLogin();
    api.post.mockImplementation(async (url) => (url.endsWith('/options') ? { data: { challenge_id: 'c', options: {} } } : { data: PASSKEY }));
    startRegistration.mockResolvedValue({ id: 'cred' });
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    const dialog = await screen.findByRole('dialog', { name: 'Passkeys' });
    await user.click(await within(dialog).findByRole('button', { name: 'Add a passkey' }));
    expect(await within(dialog).findByText('Work laptop')).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(`shms_passkey_prompt_dismissed:${USER_ID}`)).toBe('1'));
  });

  test('is not offered without a password login in this session', async () => {
    render();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/passkeys/config'));
    await Promise.resolve();
    expect(screen.queryByText(/sign in faster/i)).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/auth/passkeys');
  });

  test('is not offered to someone who already has one', async () => {
    markPasswordLogin();
    serve({ passkeys: [PASSKEY] });
    render();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/passkeys'));
    await Promise.resolve();
    expect(screen.queryByText(/sign in faster/i)).not.toBeInTheDocument();
  });

  test('waits while a temporary password is in use', async () => {
    markPasswordLogin();
    render('incoming_staff', { pwd_change: true });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/passkeys/config'));
    await Promise.resolve();
    expect(api.get).not.toHaveBeenCalledWith('/auth/passkeys');
  });

  test('dismissing still closes it when storage refuses the write', async () => {
    markPasswordLogin();
    const user = userEvent.setup();
    render();
    const notNow = await screen.findByRole('button', { name: 'Not now' });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await user.click(notNow);
    set.mockRestore();
    expect(screen.queryByText(/sign in faster/i)).not.toBeInTheDocument();
  });

  test('blocked storage means no offer, and no crash', async () => {
    markPasswordLogin();
    tokenStore.set(fakeToken('incoming_staff'));
    const original = Storage.prototype.getItem;
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function read(key) {
      if (key.startsWith('shms_passkey')) throw new Error('blocked');
      return original.call(this, key);
    });
    renderWithProviders(<PasskeyPrompt />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/passkeys/config'));
    await Promise.resolve();
    get.mockRestore();
    expect(screen.queryByText(/sign in faster/i)).not.toBeInTheDocument();
  });
});
