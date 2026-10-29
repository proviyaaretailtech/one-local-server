// What GET /api/popups returns (server/popups.ts).
export type PopupFormat = 'popup_center' | 'popup_sheet' | 'interstitial' | 'strip' | 'coming_soon' | 'letter';
// A letter's creative: a 4:5 or 1:1 photo, or a video of at most 30 s (keys or full addresses, see imageUrl).
export type PopupMedia = { type: 'photo' | 'video'; key: string; poster_key?: string; web_key?: string; width: number; height: number; seconds?: number };
// One upcoming store on a coming-soon receipt: its name, logo (media key) and a short kind ("Ice creams").
export type ComingSoonItem = { name: string; logo: string; line?: string };
export type PopupContent = { greeting?: string; title?: string; body?: string; image?: string; cta_label?: string; cta_route?: string; items?: ComingSoonItem[] };
export type Popup = {
  id: string; format: PopupFormat;
  content: Partial<Record<'en' | 'hi' | 'mr', PopupContent>>;
  trigger: 'app_open' | 'screen_view' | 'after_seconds' | 'scroll_depth' | 'first_sign_in'; trigger_value: number | null;
  screens: string[]; frequency: 'once' | 'daily' | 'session' | 'every_hours' | 'every_nth_open'; frequency_value?: number | null;
  max_shows?: number | null; priority: number; is_sponsored: boolean;
  media?: PopupMedia | null; frame?: { style?: 'royal_gold' | 'festive_red' | 'plain'; seal?: string };
  starts_at: string; ends_at: string;
};
