import { useCallback, useState } from 'react';
import { toast, toastError } from './toast';

// Wraps an async action with a busy flag, a success toast and an error toast.
// Returns [run, busy]; run(fn, successMessage?) resolves to true on success.
export default function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast.success(success);
      return true;
    } catch (err) {
      toastError(err);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return [run, busy];
}
