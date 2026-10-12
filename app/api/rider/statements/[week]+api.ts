import { json, limit, route } from '../../../../server/http';
import { requireRider } from '../../../../server/rider';
import { parseWeek, statement, statementPdf } from '../../../../server/rider-statements';

// The week's earnings statement. `/2026-W39` answers JSON; `/2026-W39.pdf` (what the rider app opens) answers a PDF.
export const GET = route(async (request, params) => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-read', 120, 60000);
  const raw = params?.week ?? '';
  const s = await statement(rider, raw);
  if (!parseWeek(raw).pdf) return json(s);
  return new Response(statementPdf(s) as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="statement-${s.week}.pdf"`, 'Cache-Control': 'private, no-store' } });
});
