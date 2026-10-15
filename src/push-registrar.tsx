import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from './auth';
import { registerPush, startInbox } from './push';

// Renders nothing. Starts the notification inbox at launch and, once a customer is signed in, registers this phone for order alerts.
export function PushRegistrar() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;
  useEffect(() => { void startInbox(url => { try { router.push(url as never); } catch { /* an old link is not worth a crash */ } }); }, [router]);
  useEffect(() => { if (userId) void registerPush(); }, [userId]);
  return null;
}
