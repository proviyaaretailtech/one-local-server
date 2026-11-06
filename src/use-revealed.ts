// A pushed screen slides in only once its first render is done, so a long list on it renders its first rows straight away
// and the rest just after the slide (as a low-priority update that never holds up a tap): false until then, then true.
import { startTransition, useEffect, useState } from 'react';
import { duration } from './motion-tokens';

export function useRevealed(): boolean {
  const [revealed, setRevealed] = useState(false);
  // The native slide-in takes about duration.gentle.
  useEffect(() => { const id = setTimeout(() => startTransition(() => setRevealed(true)), duration.gentle); return () => clearTimeout(id); }, []);
  return revealed;
}
