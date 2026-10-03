import { toast } from 'sonner';
import { errorMessage } from '../api';

// API errors come back as "Headline\n• detail\n• detail"; show the headline as
// the toast title and the details underneath.
export function toastError(err, fallbackTitle = 'Something went wrong') {
  const [title, ...details] = (typeof err === 'string' ? err : errorMessage(err) || fallbackTitle).split('\n');
  toast.error(title || fallbackTitle, details.length ? { description: details.join('\n'), duration: 8000 } : undefined);
}

export { toast };
