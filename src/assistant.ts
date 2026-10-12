import { API } from './api';
import { errorMessage, i18n, t } from './i18n';
export type ChatMessage = { role: 'user' | 'assistant'; text: string; product_ids?: string[]; comparison_query?: string; search_links?: { merchant: string; url: string }[]; live_prices_available?: boolean; basket_total?: number; budget?: number | null; cart_subtotal?: number };
export type ChatSession = { id: string; messages: ChatMessage[] };
// The server's own failure line (`detail` / an error event). A coded failure is translated; an uncoded one keeps the
// server's English sentence while the app is in English and shows the translated generic line in any other language.
// Called when the failure happens (never at module load), so it follows the language the person is using now.
const serverFailure = (code: unknown, detail: unknown) => {
  const lng = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  if (typeof code === 'string' && code) return errorMessage(t, { code }, lng);
  return typeof detail === 'string' && detail ? errorMessage(t, { message: detail }, lng) : t('assistant.err.unreachable');
};
export function streamChat(session: string, message: string, onDelta: (text: string) => void, onDone: (result: ChatMessage) => void, onError: (text: string) => void, context?: { budget: number | null; preference: 'any' | 'vegetarian'; cart_items: { id: string; qty: number }[] }) {
  const xhr = new XMLHttpRequest(); let read = 0; let buffered = ''; let done = false;
  const consume = () => {
    buffered += xhr.responseText.slice(read); read = xhr.responseText.length;
    const lines = buffered.split('\n'); buffered = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try { const e = JSON.parse(line); if (e.type === 'delta') onDelta(e.text); if (e.type === 'done') { done = true; onDone({ ...e, role: 'assistant' }); } if (e.type === 'error') { done = true; onError(serverFailure(e.code, e.message)); } } catch { /* Wait for complete NDJSON frames. */ }
    }
  };
  xhr.open('POST', `${API}/assistant/chat`); xhr.setRequestHeader('Content-Type', 'application/json'); xhr.timeout = 80000;
  xhr.onprogress = () => { if (xhr.status === 200) consume(); };
  xhr.onload = () => { if (xhr.status === 200) { consume(); if (!done) onError(t('assistant.err.interrupted')); } else { let error = t('assistant.err.unreachable'); try { const parsed = JSON.parse(xhr.responseText); error = serverFailure(parsed.code, parsed.detail); } catch {} onError(error); } };
  xhr.onerror = () => onError(t('assistant.err.connection')); xhr.ontimeout = () => onError(t('assistant.err.timeout'));
  xhr.send(JSON.stringify({ session_id: session, message, ...context }));
  return () => { xhr.onprogress = null; xhr.onload = null; xhr.onerror = null; xhr.ontimeout = null; xhr.abort(); };
}