// Support contact details come from client/.env (VITE_SUPPORT_EMAIL,
// VITE_SUPPORT_PHONE). Unset or blank values are null and hidden in the UI.
const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export const SUPPORT = {
  email: clean(import.meta.env.VITE_SUPPORT_EMAIL),
  phone: clean(import.meta.env.VITE_SUPPORT_PHONE),
};

// tel: links need digits and a leading + only.
export const telHref = (phone) => `tel:${phone.replace(/[^\d+]/g, '')}`;
