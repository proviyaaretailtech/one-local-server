// iOS add-in layer: order notifications, the order Live Activity (lock screen + Dynamic Island)
// and the home-screen widget (targets/widget). Every native module is loaded lazily and every call
// is best-effort, so Expo Go, Android and the web simply skip what they can't do.
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { t } from '@/src/i18n';

// The order journey the app shows (app/order/[id].tsx): seconds after placing → stage. The words for a stage live
// in the catalogue (notifications.<id>.title / .body) and are looked up when a notification, the Live Activity or
// the widget is written, so each carries the language the app was in at that moment.
export const ORDER_STAGES = [
  { at: 0, id: 'placed' },
  { at: 120, id: 'packed' },
  { at: 300, id: 'out' },
  { at: 600, id: 'delivered' },
] as const;
export const ORDER_TOTAL_S = 600;
export const stageAt = (elapsedS: number) => ORDER_STAGES.reduce((s, st, i) => (elapsedS >= st.at ? i : s), 0);
const stageTitle = (step: number) => t(`notifications.${ORDER_STAGES[step].id}.title`);

const isIOS = Platform.OS === 'ios';
// Expo Go can't load custom native code (Live Activities, widgets); a development build can.
const devBuild = isIOS && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
const appGroup: string | undefined = Constants.expoConfig?.extra?.appGroup;

function load<T>(get: () => T): T | null { try { return get(); } catch { return null; } }
const notifications = () => (Platform.OS === 'web' ? null : load(() => require('expo-notifications') as typeof import('expo-notifications')));
const extensionStorage = () => (devBuild && appGroup ? load(() => require('@bacons/apple-targets').ExtensionStorage) : null);

// ---------- Notifications ----------
let handlerSet = false;
export async function enableOrderNotifications(): Promise<boolean> {
  const N = notifications(); if (!N) return false;
  try {
    if (!handlerSet) {
      N.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
      handlerSet = true;
    }
    const current = await N.getPermissionsAsync();
    const status = current.granted ? current : await N.requestPermissionsAsync();
    return !!status.granted;
  } catch { return false; }
}

// Queue the order's journey as local notifications (they arrive even if the app is closed).
export async function scheduleOrderJourney(orderId: string, placedAt: number) {
  const N = notifications(); if (!N || !(await enableOrderNotifications())) return;
  for (const st of ORDER_STAGES.slice(1)) {
    const seconds = Math.round((placedAt + st.at * 1000 - Date.now()) / 1000);
    if (seconds <= 0) continue;
    await N.scheduleNotificationAsync({
      identifier: `order-${orderId}-${st.at}`,
      content: { title: `OneLocal · ${t(`notifications.${st.id}.title`)}`, body: t(`notifications.${st.id}.body`), data: { url: `/order/${orderId}` } },
      trigger: { type: N.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds },
    }).catch(() => {});
  }
}

// ---------- Home-screen widget ----------
export type WidgetOrder = { orderId: string; step: number; etaMinutes: number; itemCount: number; total: string; firstItem: string };
export function updateOrderWidget(order: WidgetOrder | null) {
  const Storage = extensionStorage(); if (!Storage) return;
  try {
    const store = new Storage(appGroup);
    if (order) store.set('onecity.latestOrder', JSON.stringify({ ...order, status: stageTitle(order.step) }));
    else store.remove('onecity.latestOrder');
    Storage.reloadWidget();
  } catch {}
}

// ---------- Live Activity (lock screen + Dynamic Island) ----------
// Drawn by targets/widget/OrderLiveActivity.swift; started/updated through the local module
// modules/onecity-live-activity (ActivityKit). The native side finds the activity by order id.
const liveActivity = () => (devBuild ? load(() => require('../../modules/onecity-live-activity').default as typeof import('../../modules/onecity-live-activity').default) : null);

// Brings the order's activity to `step`: starts it if needed (while not delivered), then updates it;
// the final step ends it. `etaEndMs` is the real arrival time when live tracking has one (app/order/[id].tsx);
// without it the sample journey's end (placed + ORDER_TOTAL_S) is used.
export function syncOrderActivity(orderId: string, step: number, summary: string, placedAt: number, etaEndMs?: number) {
  const LA = liveActivity(); if (!LA) return;
  const etaEnd = etaEndMs ?? placedAt + ORDER_TOTAL_S * 1000; const title = stageTitle(step);
  const started = step < 3 ? LA.start(orderId, title, step, etaEnd, summary) : Promise.resolve(null);
  started.then(() => LA.update(orderId, title, step, etaEnd, summary)).catch(() => {});
}
