// The rider marker's position between two GPS fixes. A new fix arrives every poll (10 s or so); instead of jumping,
// the marker travels from where it is now to the new fix over about one poll interval, so it is still moving when the
// next fix lands. Heading is interpolated the short way round. With reduced motion, or after a big jump, it snaps.
// Updates are throttled to ~15 per second: the marker is a React view (web) or a native map marker (phones).
import { useEffect, useRef, useState } from 'react';
import { glideFix, glideT, haversineM, SNAP_DISTANCE_M, type RiderFix } from './utils/tracking';

const FRAME_MS = 66;

export function useGlidingFix(target: RiderFix | null, durationMs: number, animate: boolean): RiderFix | null {
  const [shown, setShown] = useState<RiderFix | null>(target);
  const current = useRef<RiderFix | null>(target);
  const lat = target?.lat, lng = target?.lng, heading = target?.heading ?? null, has = !!target;

  useEffect(() => {
    if (lat === undefined || lng === undefined) { current.current = null; return; } // no rider: the hook returns null below
    const to: RiderFix = { lat, lng, heading };
    const from = current.current;
    const jump = from ? haversineM(from, to) : 0;
    if (!animate || !from || jump > SNAP_DISTANCE_M) {
      // First fix, reduced motion, or a re-sync after a long gap: no travelling. A snap keeps the heading it knows.
      const snapped = from && to.heading === null ? { ...to, heading: from.heading } : to;
      current.current = snapped;
      const snap = requestAnimationFrame(() => setShown(snapped));
      return () => cancelAnimationFrame(snap);
    }
    if (jump < 0.5 && (to.heading === null || from.heading === to.heading)) return; // the same spot again: nothing to draw
    const start = Date.now();
    let frame: ReturnType<typeof requestAnimationFrame> | undefined;
    let lastDraw = 0;
    const step = () => {
      const t = glideT(Date.now() - start, durationMs);
      const mid = glideFix(from, to, t);
      const next: RiderFix = t >= 1 ? { lat: to.lat, lng: to.lng, heading: mid.heading } : mid;
      current.current = next;
      if (t >= 1 || Date.now() - lastDraw >= FRAME_MS) { lastDraw = Date.now(); setShown(next); }
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); };
    // `has` flips when the rider appears or disappears; lat/lng/heading when a new fix arrives.
  }, [lat, lng, heading, has, durationMs, animate]);

  return has ? shown : null;
}
