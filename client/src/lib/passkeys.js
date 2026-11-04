import { useEffect, useState } from 'react';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import api from '../api';

// Passkey UI shows only when this browser supports WebAuthn and the server has
// passkeys on. The answer is kept for the page's life; a failed check is not,
// so a brief network problem doesn't hide passkeys until the next reload.
let configPromise = null;
function loadEnabled() {
  configPromise ??= api.get('/auth/passkeys/config')
    .then((r) => r.data?.passkeys === true)
    .catch(() => {
      configPromise = null;
      return false;
    });
  return configPromise;
}

export function resetPasskeyConfigForTests() {
  configPromise = null;
}

export function usePasskeysAvailable() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!browserSupportsWebAuthn()) return undefined;
    let live = true;
    loadEnabled().then((on) => { if (live) setAvailable(on); });
    return () => { live = false; };
  }, []);
  return available;
}

// The device's prompt was dismissed or timed out: not an error worth alarming over.
export const isPasskeyCancel = (err) => err?.name === 'NotAllowedError' || err?.name === 'AbortError';

// This device already holds a passkey for this account (excludeCredentials).
export const isPasskeyDuplicate = (err) => err?.name === 'InvalidStateError';

// Returns { token, user }, the same as a password login.
export async function signInWithPasskey() {
  const { data: { challenge_id: challengeId, options } } = await api.post('/auth/passkeys/login/options');
  const response = await startAuthentication({ optionsJSON: options });
  return (await api.post('/auth/passkeys/login/verify', { challenge_id: challengeId, response })).data;
}

// Returns the new passkey's list row.
export async function addPasskey(label) {
  const { data: { challenge_id: challengeId, options } } = await api.post('/auth/passkeys/register/options');
  const response = await startRegistration({ optionsJSON: options });
  return (await api.post('/auth/passkeys/register/verify', { challenge_id: challengeId, response, label })).data;
}

// A starting label for a new passkey, which the user can change.
export function defaultPasskeyLabel(ua = navigator.userAgent) {
  const device = [
    [/iPhone/, 'iPhone'], [/iPad/, 'iPad'], [/Android/, 'Android'], [/Windows/, 'Windows'], [/Macintosh|Mac OS/, 'Mac'], [/CrOS/, 'Chromebook'], [/Linux/, 'Linux'],
  ].find(([re]) => re.test(ua));
  return device ? `${device[1]} passkey` : 'My passkey';
}

// ---- The offer to add a passkey after a password login -----------------------
// Storage can throw (private windows, blocked site data), so every access is
// guarded; without it the worst case is seeing the offer again.

const OFFER_KEY = 'shms_passkey_offer';
const dismissedKey = (userId) => `shms_passkey_prompt_dismissed:${userId}`;

export function markPasswordLogin() {
  try { sessionStorage.setItem(OFFER_KEY, '1'); } catch { /* no offer this time */ }
}

export function passkeyOfferPending(userId) {
  try {
    return sessionStorage.getItem(OFFER_KEY) === '1' && localStorage.getItem(dismissedKey(userId)) !== '1';
  } catch {
    return false;
  }
}

export function dismissPasskeyOffer(userId) {
  try { localStorage.setItem(dismissedKey(userId), '1'); } catch { /* shown again next time */ }
}
