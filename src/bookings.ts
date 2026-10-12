import AsyncStorage from '@react-native-async-storage/async-storage';
export type SavedEnquiry = { id: string; title: string; date: string; slot: string; guests: number; created_at: string };
const KEY = 'onelatur.booking-enquiries';
export async function getEnquiries(): Promise<SavedEnquiry[]> { const data = await AsyncStorage.getItem(KEY); return data ? JSON.parse(data) : []; }
/** The booking's "YYYY-MM-DD" as noon on that India calendar day, ready for fmt.date(). Null when it is not a date. */
export function bookingDay(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const day = new Date(`${iso}T12:00:00+05:30`);
  return Number.isNaN(day.getTime()) ? null : day;
}
export async function saveEnquiry(item: SavedEnquiry) { const items = await getEnquiries(); await AsyncStorage.setItem(KEY, JSON.stringify([item, ...items.filter(i => i.id !== item.id)])); }