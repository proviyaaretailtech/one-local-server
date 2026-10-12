// What GET /api/popups returns (server/popups.ts).
export type PopupFormat = 'popup_center' | 'popup_sheet' | 'interstitial' | 'strip' | 'coming_soon';
// One upcoming store on a coming-soon receipt: its name, logo (media key) and a short kind ("Ice creams").
export type ComingSoonItem = { name: string; logo: string; line?: string };
export type PopupContent = { title?: string; body?: string; image?: string; cta_label?: string; cta_route?: string; items?: ComingSoonItem[] };
export type Popup = {
  id: string; format: PopupFormat;
  content: Partial<Record<'en' | 'hi' | 'mr', PopupContent>>;
  trigger: 'app_open' | 'screen_view' | 'after_seconds' | 'scroll_depth'; trigger_value: number | null;
  screens: string[]; frequency: 'once' | 'daily' | 'session'; priority: number; is_sponsored: boolean;
  starts_at: string; ends_at: string;
};
