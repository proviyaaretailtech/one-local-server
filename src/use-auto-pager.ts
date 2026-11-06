// A row of pages that moves on by itself, always forwards: after the last page comes the first again. A copy of the first
// page sits after the last, so moving on from the last slides forwards into it; once there the row jumps back to the real
// first page, which looks the same. A finger on the row, Reduce Motion or leaving the screen stops the movement.
// `dwell` is how long a page stays, by its index. Food's ad carousel and Home's hero use it.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScrollView } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useMotionAllowed } from './motion';

export function useAutoPager(count: number, step: number, dwell: (index: number) => number) {
  const motion = useMotionAllowed(); const focused = useIsFocused();
  const list = useRef<ScrollView>(null); const [index, setIndex] = useState(0); const [held, setHeld] = useState(false);
  // The scroll handler reads the finger from here, so it stays the same function for the scroll view.
  const holding = useRef(false);
  const loops = count > 1; const running = loops && motion && focused && !held; const wait = dwell(index);
  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => list.current?.scrollTo({ x: (index + 1) * step, animated: true }), wait);
    return () => clearTimeout(id);
  }, [running, index, step, wait]);
  const onScroll = useCallback((x: number) => {
    if (count > 1 && x >= count * step - 1 && !holding.current) { list.current?.scrollTo({ x: 0, animated: false }); setIndex(0); return; }
    setIndex(Math.round(x / step) % count);
  }, [count, step]);
  const go = (n: number) => list.current?.scrollTo({ x: n * step, animated: true });
  const hold = (on: boolean) => { holding.current = on; setHeld(on); };
  const touch = { onTouchStart: () => hold(true), onTouchEnd: () => hold(false), onTouchCancel: () => hold(false) };
  return { list, index, loops, running, wait, go, onScroll, touch };
}
