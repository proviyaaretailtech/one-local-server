// Checks the weight -> Poppins family rule (src/ui/text.tsx). No React Native needed for the mapping itself.
// Run from frontend/:  npx tsx scripts/font-checks.ts
let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => {
  if (!ok) { console.error(`FAIL  ${what}`, detail === undefined ? '' : JSON.stringify(detail)); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
};
// The wrapper imports react-native (Flow source), so the mapping is read from the file text and evaluated on its own.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../src/ui/text.tsx', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('const FAMILY'), src.indexOf('const withFont')).replace(/export function poppinsFamily\(weight: unknown\): string/, 'function poppinsFamily(weight)').replace(/ as const/g, '').replace(/: unknown/g, '');
const poppinsFamily = new Function(`${body}; return poppinsFamily;`)() as (w: unknown) => string;
for (const [w, f] of [[undefined, 'Poppins_400Regular'], ['normal', 'Poppins_400Regular'], ['400', 'Poppins_400Regular'], ['100', 'Poppins_400Regular'], ['500', 'Poppins_500Medium'], ['600', 'Poppins_600SemiBold'], ['bold', 'Poppins_700Bold'], ['700', 'Poppins_700Bold'], [700, 'Poppins_700Bold'], ['800', 'Poppins_800ExtraBold'], ['900', 'Poppins_800ExtraBold'], ['weird', 'Poppins_400Regular']] as const)
  check(`fontWeight ${JSON.stringify(w)} -> ${f}`, poppinsFamily(w) === f, poppinsFamily(w));
console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
