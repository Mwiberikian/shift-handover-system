import { useEffect, useRef, useState } from 'react';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import api from '../../api';
import { useTheme } from '../../theme/ThemeContext';
import { toast } from '../../lib/toast';

// The OAuth client id comes from the server (GET /auth/google/config), so one
// env var (GOOGLE_CLIENT_ID in server/.env) turns the feature on or off.
// undefined = loading, null = not configured.
let configPromise;
function loadClientId() {
  configPromise ??= api.get('/auth/google/config').then((r) => r.data.client_id).catch(() => null);
  return configPromise;
}

export function useGoogleClientId() {
  const [clientId, setClientId] = useState(undefined);
  useEffect(() => {
    let live = true;
    loadClientId().then((id) => { if (live) setClientId(id); });
    return () => { live = false; };
  }, []);
  return clientId;
}

// Google's own "Continue with Google" button (Google Identity Services).
// Renders nothing unless Google sign-in is configured. `onCredential` gets the
// ID token, which must be verified by the server.
export default function GoogleButton({ onCredential, text = 'continue_with', divider = true }) {
  const clientId = useGoogleClientId();
  const { theme } = useTheme();
  const box = useRef(null);
  const [width, setWidth] = useState(320);

  useEffect(() => {
    if (!box.current) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.min(400, Math.floor(e.contentRect.width)))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [clientId]);

  if (!clientId) return null;
  return (
    <div className="space-y-4">
      {divider && (
        <div className="flex items-center gap-3 text-meta text-ink-600" aria-hidden>
          <span className="h-px flex-1 bg-ink-900/10" /> or <span className="h-px flex-1 bg-ink-900/10" />
        </div>
      )}
      <div ref={box} className="flex min-h-10 justify-center">
        <GoogleOAuthProvider clientId={clientId}>
          {/* Keyed on theme so Google re-renders its button in the matching style. */}
          <GoogleLogin
            key={`${theme}-${width}`}
            onSuccess={({ credential }) => onCredential(credential)}
            onError={() => toast.error('Google sign-in did not complete. Please try again.')}
            text={text}
            theme={theme === 'dark' ? 'filled_black' : 'outline'}
            size="large"
            shape="rectangular"
            logo_alignment="center"
            width={width}
          />
        </GoogleOAuthProvider>
      </div>
    </div>
  );
}
