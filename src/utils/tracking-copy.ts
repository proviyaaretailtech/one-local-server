// The words on the live ETA card, chosen from an EtaView (src/utils/tracking.ts). Kept out of the screen so
// scripts/tracking-ui-checks.ts can run the real catalogue through it: a road ETA reads "12 min"; an estimate or the
// promise made at checkout reads "About 12 min" with an "Around 7:45 pm" clock time; the states with no ETA read as a status.
import type { TFunction } from 'i18next';
import type { Formatter } from '../i18n/format';
import type { EtaView } from './tracking';

export type EtaCopy = { label: string; text: string; when: string; source: string };

export function etaCopy(view: EtaView, t: TFunction, fmt: Pick<Formatter, 'eta' | 'time'>): EtaCopy {
  switch (view.kind) {
    case 'eta': {
      const time = fmt.eta(view.minutes);
      return {
        label: t('tracking.live.etaLabel'),
        text: view.approx ? t('tracking.live.etaAbout', { time }) : time,
        when: t(view.approx ? 'tracking.live.arrivesAround' : 'tracking.live.arrivesBy', { time: fmt.time(view.arrivesAt) }),
        source: t(view.source === 'road' ? 'tracking.live.sourceRoad' : view.source === 'estimate' ? 'tracking.live.sourceEstimate' : 'tracking.live.sourcePromise'),
      };
    }
    case 'unknown': return { label: t('tracking.live.etaLabel'), text: t('tracking.live.etaUnknown'), when: '', source: '' };
    default: return { label: t('tracking.live.statusLabel'), text: t(`tracking.phase.${view.kind}`), when: '', source: '' };
  }
}
