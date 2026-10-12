// Name matching between the rider's name and the name on a document. A document must be the rider's own.
export type NameMatch = 'good' | 'partial' | 'poor';

const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'SHRI', 'SMT', 'KUM', 'DR', 'SRI', 'SMT.', 'M/S']);

export const nameTokens = (name: string): string[] =>
  name.toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(t => t && !TITLES.has(t));

const tokenMatches = (a: string, b: string): boolean => a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));

// good    every word of the shorter name appears in the other (initials allowed): "Rahul Sharma" / "RAHUL K SHARMA"
// partial at least half of them do: "Rahul Sharma" / "RAHUL VERMA"
// poor    fewer: someone else's document
export const matchNames = (riderName: string, otherName: string): { result: NameMatch; score: number } => {
  const a = nameTokens(riderName);
  const b = nameTokens(otherName);
  if (!a.length || !b.length) return { result: 'poor', score: 0 };
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const used = new Set<number>();
  let hits = 0;
  for (const t of short) {
    const i = long.findIndex((u, idx) => !used.has(idx) && tokenMatches(t, u));
    if (i >= 0) { used.add(i); hits += 1; }
  }
  const score = hits / short.length;
  return { result: score >= 0.999 ? 'good' : score >= 0.5 ? 'partial' : 'poor', score: Math.round(score * 100) / 100 };
};

// Cashfree's own verdict, when the verification API returns one.
export const fromCashfreeMatch = (v: unknown): NameMatch | null => {
  switch (String(v ?? '').toUpperCase()) {
    case 'DIRECT_MATCH':
    case 'GOOD_PARTIAL_MATCH': return 'good';
    case 'MODERATE_PARTIAL_MATCH':
    case 'POOR_PARTIAL_MATCH': return 'partial';
    case 'NO_MATCH': return 'poor';
    default: return null;
  }
};

// The stricter of our comparison and Cashfree's.
export const combineMatch = (ours: NameMatch, theirs: NameMatch | null): NameMatch => {
  if (!theirs) return ours;
  const rank: Record<NameMatch, number> = { poor: 0, partial: 1, good: 2 };
  return rank[ours] <= rank[theirs] ? ours : theirs;
};
