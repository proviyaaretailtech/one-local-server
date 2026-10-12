// Which part of the world the tracking map shows. It follows the rule in shouldRefit (src/utils/tracking.ts): the
// frame changes on a new phase, when something falls outside it, or when everything has come twice as close. A poll
// that only moves the rider a little leaves the frame alone, so the map does not jitter.
import { useEffect, useMemo, useRef, useState } from 'react';
import { boundsOf, framePoints, shouldRefit, type Bounds, type LatLng, type TrackingLive } from './utils/tracking';

export function useMapFrame(tracking: TrackingLive, route: LatLng[]): Bounds | null {
  const { phase, rider, store, drop } = tracking;
  const riderLat = rider?.lat, riderLng = rider?.lng;
  const wanted = useMemo(
    () => boundsOf(framePoints({ phase, store, drop, rider: riderLat === undefined || riderLng === undefined ? null : { lat: riderLat, lng: riderLng } }, route)),
    // store / drop are new objects on every poll; their numbers are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, riderLat, riderLng, store.lat, store.lng, drop.lat, drop.lng, route],
  );
  const [frame, setFrame] = useState<Bounds | null>(wanted);
  const lastPhase = useRef(phase);
  useEffect(() => {
    const phaseChanged = lastPhase.current !== phase;
    lastPhase.current = phase;
    if (!wanted) return;
    setFrame(prev => (phaseChanged || shouldRefit(prev, wanted) ? wanted : prev));
  }, [wanted, phase]);
  return frame;
}
