import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { syncPush } from '../push';

// Keeps this device's push subscription attached to whoever is logged in:
// re-sends it on every login/app start (subscriptions can rotate, and a shared
// phone's subscription must follow the current player). Renders nothing.
export default function PushSync() {
  const { user } = useAuth();
  useEffect(() => {
    if (user?.userId) void syncPush().catch(() => {});
  }, [user?.userId]);
  return null;
}
