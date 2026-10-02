import axios from 'axios';

const TOKEN_KEY = 'shms_token';

// sessionStorage: the token disappears when the tab closes, which suits shared
// operations-room terminals better than localStorage.
export const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (t) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// An expired/invalid token sends the user back to the login page.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.endsWith('/auth/login')) {
      tokenStore.clear();
      window.dispatchEvent(new Event('shms:logout'));
    }
    return Promise.reject(err);
  },
);

// Human-readable message from an API error, including field-level details.
export function errorMessage(err) {
  const data = err.response?.data;
  if (!data) return err.message;
  const details = data.details?.missing_fields
    ?? (Array.isArray(data.details) ? data.details : null);
  if (!details) return data.error;
  const lines = details.map((d) => (typeof d === 'string' ? d : `${d.label || d.field}: ${d.reason || d.message}`));
  return `${data.error}\n• ${lines.join('\n• ')}`;
}

// Decodes the JWT payload (no verification; the server verifies every call).
export function decodeToken(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

export default api;
