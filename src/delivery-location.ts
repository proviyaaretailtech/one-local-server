import { createContext, useContext } from 'react';
import type { Coverage } from './places';

export type Point = { lat: number; lng: number };

// The address the customer is shopping for: display text plus, when known, its map position
// (needed for delivery-area checks and distances). `coverage` says what One Local offers there
// (live, discover-only listings, or not yet) and names the town; null until it has been checked.
export const DeliveryLocationContext = createContext<{
  location: string;
  point: Point | null;
  coverage: Coverage | null;
  edit: () => void;
  setLocation: (value: string, point?: Point | null) => void;
}>({ location: 'Latur, Maharashtra', point: null, coverage: null, edit: () => {}, setLocation: () => {} }); // i18n-ignore: the default place name is data (a town), not UI text

export const useDeliveryLocation = () => useContext(DeliveryLocationContext);
