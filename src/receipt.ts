// The plain-text receipt a customer can share or copy for an order. Pure: the words (labels), money and date formatting come from
// the caller, so it follows the app language. It is an order receipt, not a GST tax invoice: it states what was ordered and paid,
// using only what the order itself recorded.
import type { Order } from './api';

export type ReceiptLabels = {
  title: string; order: string; date: string; store: string; deliverTo: string; items: string; subtotal: string;
  discount: string; delivery: string; tax: string; total: string; payment: string; footer: string;
};

export function buildReceipt(order: Order, labels: ReceiptLabels, fmt: { money: (n: number) => string; date: (v: string) => string }, method?: string): string {
  const lines: string[] = [labels.title, '', `${labels.order}: #${order.id.slice(0, 8).toUpperCase()}`, `${labels.date}: ${fmt.date(order.created_at)}`];
  if (order.store_name) lines.push(`${labels.store}: ${order.store_name}`);
  if (order.address?.text) lines.push(`${labels.deliverTo}: ${order.address.text}`);
  lines.push('', `${labels.items}:`);
  for (const it of order.items) lines.push(`${it.qty} × ${it.name}${it.weight ? ` (${it.weight})` : ''} — ${fmt.money(it.price * it.qty)}`);
  lines.push('', `${labels.subtotal}: ${fmt.money(order.subtotal)}`);
  if (order.discount > 0) lines.push(`${labels.discount}: −${fmt.money(order.discount)}`);
  lines.push(`${labels.delivery}: ${fmt.money(order.delivery_fee)}`);
  if (order.gst && order.gst > 0) lines.push(`${labels.tax}: ${fmt.money(order.gst)}`);
  lines.push(`${labels.total}: ${fmt.money(order.total)}`);
  if (method) lines.push(`${labels.payment}: ${method}`);
  lines.push('', labels.footer);
  return lines.join('\n');
}
