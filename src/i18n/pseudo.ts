// Dev-only pseudo-locale "en-XA": the English catalogue with accented letters, ~35% longer and wrapped in
// brackets. Pick it in the Language screen (development builds only) to spot, without reading Hindi:
//   - text that is still hard-coded (it stays plain English, with no accents or brackets),
//   - layouts that break when text grows (Hindi runs 20-30% longer),
//   - strings glued together from pieces ({{placeholders}} must survive untouched).
// Never listed in a production build (see locales.ts).

const ACCENTS: Record<string, string> = {
  a: 'à', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
  n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'À', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
  N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

// Things i18next or react-i18next interpret: {{value}}, {{value, format}}, $t(nested.key), <0>…</0> / <b>…</b>.
const PROTECTED = /(\{\{[^}]*\}\}|\$t\([^)]*\)|<\/?\d+>|<\/?[a-z][a-z0-9]*\s*\/?>)/g;

export function pseudoString(text: string): string {
  const parts = text.split(PROTECTED);
  let letters = 0;
  const mapped = parts.map((part, i) => {
    if (i % 2 === 1) return part; // a protected token: keep as is
    return part.replace(/[A-Za-z]/g, ch => { letters += 1; return ACCENTS[ch] ?? ch; });
  }).join('');
  if (letters === 0) return text; // nothing to localise (a symbol or a bare placeholder)
  return `[${mapped}${'·'.repeat(Math.ceil(letters * 0.35))}]`;
}

export function pseudoLocalize<T>(catalogue: T): T {
  if (typeof catalogue === 'string') return pseudoString(catalogue) as unknown as T;
  if (Array.isArray(catalogue)) return catalogue.map(pseudoLocalize) as unknown as T;
  if (catalogue && typeof catalogue === 'object') {
    return Object.fromEntries(Object.entries(catalogue).map(([k, v]) => [k, pseudoLocalize(v)])) as T;
  }
  return catalogue;
}
