// Book It: the brand header on a wash of Book It's sky blue, then what can be booked, as tiles: dining and events on top,
// activities, play and stay below, then a "Book an appointment" button over breakdown help and a doctor. None is open yet,
// so every tile and the button answer with the app's coming-soon message.
import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient as SvgGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import Icon from '@react-native-vector-icons/ionicons';
import { Text } from '@/src/ui/text';
import { IconTile } from '@/src/ui/icon-tile';
import { Tap } from '@/src/components/tap';
import { BrandHeader } from '@/src/components/brand-header';
import { colors, popBase, radius } from '@/src/theme';
import { CityScroll } from '@/src/motion';
import { useAppDimensions } from '@/src/layout';
import { useScreenPalette } from '@/src/use-screen-path';
import { announceComingSoon } from '@/src/coming-soon-mode';
import { useFormat, useTranslation } from '@/src/i18n';

const SIDE = 16;
const GAP = 12;
const WASH = 480; // how far down the page's blue wash (and its backdrop) runs
const CARD_GAP = 20; // the space round the appointment card

const OUTINGS = [
  [{ id: 'dining', name: 'bookItPage.dining', icon: require('../../assets/images/book-it/dining.png') }, { id: 'events', name: 'bookItPage.events', icon: require('../../assets/images/book-it/events.png') }],
  [{ id: 'activities', name: 'bookItPage.activities', icon: require('../../assets/images/book-it/activities.png') }, { id: 'play', name: 'bookItPage.play', icon: require('../../assets/images/book-it/play.png') }, { id: 'stay', name: 'bookItPage.stay', icon: require('../../assets/images/book-it/stay.png') }],
] as const;
const APPOINTMENTS = [{ id: 'breakdown', name: 'bookItPage.breakdown', icon: require('../../assets/images/book-it/breakdown.png') }, { id: 'doctor', name: 'bookItPage.doctor', icon: require('../../assets/images/book-it/doctor.png') }] as const;
type Option = (typeof OUTINGS)[number][number] | (typeof APPOINTMENTS)[number];

export default function BookIt() {
  const { t } = useTranslation(); const fmt = useFormat(); const palette = useScreenPalette(); const { width } = useAppDimensions();
  // Where the tiles leave the page showing, for the backdrop: halfway down the outings (between their two rows), their
  // foot (above the appointment card) and the foot of the last tiles.
  const [outings, setOutings] = useState<{ y: number; height: number } | null>(null); const [end, setEnd] = useState(0);
  const gaps = outings && end ? { rows: outings.y + outings.height / 2, card: outings.y + outings.height + CARD_GAP / 2, end } : null;
  // Tiles share a row's width, two or three to a row.
  const across = (n: number, room: number) => (room - GAP * (n - 1)) / n;
  const option = ({ id, name, icon }: Option, size: number) => <Tap key={id} testID={`book-option-${id}`} accessibilityRole="button" accessibilityLabel={t(name)} onPress={announceComingSoon} style={[s.option, { width: size }]}>
    <IconTile source={icon} variant="sky" />
    <Text numberOfLines={2} style={s.optionName}>{t(name)}</Text>
  </Tap>;
  return <CityScroll testID="department-screen-book-it" bleed showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
    {/* A light wash of the page's own colour (the sky blue the dock picks Book It out in), fading to white. */}
    <LinearGradient pointerEvents="none" colors={[palette.top, palette.mid, colors.surface]} locations={[0, 0.5, 1]} style={s.wash} />
    <Backdrop width={width} gaps={gaps} />
    <BrandHeader tone="light" origin={false} />
    <View onLayout={e => setOutings(e.nativeEvent.layout)} style={s.outings}>
      {OUTINGS.map(row => <View key={row[0].id} style={s.row}>{row.map(o => option(o, across(row.length, width - SIDE * 2)))}</View>)}
    </View>
    <View onLayout={e => setEnd(e.nativeEvent.layout.y + e.nativeEvent.layout.height)} style={s.appointments}>
      <Tap testID="book-appointment" accessibilityRole="button" accessibilityLabel={t('bookItPage.appointment')} onPress={announceComingSoon} style={s.appointment}>
        {/* Two soft rings of light round the arrow, for depth. */}
        <View pointerEvents="none" style={s.appointmentLight}><View style={[s.disc, s.discOuter]} /><View style={[s.disc, s.discInner]} /></View>
        {/* Today's page of a tear-off calendar: the month on a lime band with its two ring holes, the date below. */}
        <View style={s.datePage}>
          <View style={s.dateBand}><View style={[s.ringHole, { left: 7 }]} /><View style={[s.ringHole, { right: 7 }]} /><Text style={s.dateMonth}>{fmt.date(new Date(), 'month')}</Text></View>
          <View style={s.dateBody}><Text style={s.dateDay}>{fmt.date(new Date(), 'day')}</Text></View>
        </View>
        <View style={s.appointmentCopy}>
          <Text style={s.appointmentTitle}>{t('bookItPage.appointment')}</Text>
          <Text style={s.appointmentLine}>{t('bookItPage.appointmentLine')}</Text>
        </View>
        <View style={s.appointmentGo}><Icon name="arrow-forward" size={18} color={colors.book} /></View>
      </Tap>
      <View style={s.row}>{APPOINTMENTS.map(o => option(o, across(APPOINTMENTS.length, width - SIDE * 2)))}</View>
    </View>
  </CityScroll>;
}

// An admit-one ticket `w` by `h`, its corners rounded and a notch bitten out of each side.
const ticket = (w: number, h: number) => {
  const r = 12; const n = 9; const m = h / 2;
  return `M${r},0 H${w - r} A${r},${r} 0 0 1 ${w},${r} V${m - n} A${n},${n} 0 0 0 ${w},${m + n} V${h - r} A${r},${r} 0 0 1 ${w - r},${h} H${r} A${r},${r} 0 0 1 0,${h - r} V${m + n} A${n},${n} 0 0 0 0,${m - n} V${r} A${r},${r} 0 0 1 ${r},0 Z`;
};
// A four-pointed sparkle `size` across, centred on (x, y).
const sparkle = (x: number, y: number, size: number) => { const r = size / 2; return `M${x},${y - r} Q${x},${y} ${x + r},${y} Q${x},${y} ${x},${y + r} Q${x},${y} ${x - r},${y} Q${x},${y} ${x},${y - r} Z`; };

// Behind the page, in Book It's own blue, the things it books, each shaded deeper at the top and fading out: two admit-one
// tickets at the top right running off the edge of the screen (an outing), and further down, peeking out from behind the
// tiles, a calendar page with its date ringed (an appointment), a clock face at the left edge (a time) and a map pin
// below the last tiles (a place); a soft glow of light and a few sparkles among them. `gaps` are where the tiles leave
// the page showing (between the two rows, above the appointment card, below the last row); until they are measured
// only the top is drawn. Drawn in code, so it stays sharp and loads with the page; it scrolls with it.
type Gaps = { rows: number; card: number; end: number };
function Backdrop({ width, gaps }: { width: number; gaps: Gaps | null }) {
  const W = 200; const H = 112; const x = width - 158; const y = 112;
  const tone = { fill: 'url(#book-shade)', stroke: 'url(#book-edge)', strokeWidth: 1.2 } as const;
  const ink = { stroke: colors.book, strokeOpacity: 0.24, strokeWidth: 1.6, strokeLinecap: 'round' } as const;
  return <Svg pointerEvents="none" width={width} height={gaps ? gaps.end + 60 : WASH} style={s.backdrop}>
    <Defs>
      <RadialGradient id="book-glow" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={colors.surface} stopOpacity={0.7} /><Stop offset="1" stopColor={colors.surface} stopOpacity={0} /></RadialGradient>
      <SvgGradient id="book-shade" x1="0" y1="0" x2="0.25" y2="1"><Stop offset="0" stopColor={colors.book} stopOpacity={0.2} /><Stop offset="1" stopColor={colors.book} stopOpacity={0.05} /></SvgGradient>
      <SvgGradient id="book-edge" x1="0" y1="0" x2="0.25" y2="1"><Stop offset="0" stopColor={colors.book} stopOpacity={0.3} /><Stop offset="1" stopColor={colors.book} stopOpacity={0.06} /></SvgGradient>
    </Defs>
    <Ellipse cx={width * 0.18} cy={40} rx={width * 0.55} ry={190} fill="url(#book-glow)" />
    {/* The ticket behind peeks out above; the one in front has a soft shadow, a stub with a star and a perforation. */}
    <G transform={`translate(${x + 40} ${y - 92}) rotate(16) scale(0.82)`}>
      <Path d={ticket(W, H)} {...tone} strokeWidth={1} />
    </G>
    <G transform={`translate(${x} ${y}) rotate(-10)`}>
      <Path d={ticket(W, H)} transform="translate(6 9)" fill={colors.book} fillOpacity={0.06} />
      <Path d={ticket(W, H)} {...tone} />
      <Path d={`M${W * 0.3},16 V${H - 16}`} {...ink} strokeOpacity={0.26} strokeWidth={1.4} strokeDasharray="3 5" />
      <Path d={sparkle(W * 0.15, H / 2, 20)} fill={colors.book} fillOpacity={0.2} />
    </G>
    <Path d={sparkle(width * 0.37, 38, 10)} fill={colors.surface} />
    {!!gaps && <>
      {/* The calendar page at the right, between the two rows of tiles: its rings, the band at its top, a month of dates
          with one ringed. */}
      <G transform={`translate(${width - 50} ${gaps.rows - 36}) rotate(12) scale(0.8)`}>
        <Path d="M10,8 H62 A10,10 0 0 1 72,18 V70 A10,10 0 0 1 62,80 H10 A10,10 0 0 1 0,70 V18 A10,10 0 0 1 10,8 Z" {...tone} />
        <Path d="M10,8 H62 A10,10 0 0 1 72,18 V26 H0 V18 A10,10 0 0 1 10,8 Z" fill={colors.book} fillOpacity={0.12} />
        <Path d="M20,2 V14 M52,2 V14" {...ink} strokeOpacity={0.32} strokeWidth={4} />
        {[0, 1, 2].map(r => [0, 1, 2, 3].map(c => <Circle key={`${r}${c}`} cx={15 + c * 14} cy={38 + r * 13} r={2.4} fill={colors.book} fillOpacity={0.2} />))}
        <Circle cx={43} cy={51} r={6.5} fill="none" {...ink} strokeOpacity={0.34} />
      </G>
      {/* The clock at the left edge, above the appointment card: its marks and hands, cut off by the edge. */}
      <G transform={`translate(-8 ${gaps.card - 4})`}>
        <Circle r={38} {...tone} />
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => { const a = i * Math.PI / 6; const r0 = i % 3 ? 31 : 28;
          return <Path key={i} d={`M${Math.sin(a) * r0},${-Math.cos(a) * r0} L${Math.sin(a) * 34},${-Math.cos(a) * 34}`} {...ink} strokeWidth={i % 3 ? 1.1 : 1.6} />; })}
        <Path d="M0,0 L12,-14 M0,0 L22,4" {...ink} strokeWidth={2} />
      </G>
      {/* The map pin below the last tiles. */}
      <G transform={`translate(26 ${gaps.end + 4}) rotate(-8) scale(0.85)`}>
        <Path d="M12,32 C12,32 0,20 0,12 A12,12 0 0 1 24,12 C24,20 12,32 12,32 Z M12,7.5 A4.5,4.5 0 1 0 12,16.5 A4.5,4.5 0 1 0 12,7.5 Z" fillRule="evenodd" {...tone} />
      </G>
      <Path d={sparkle(width - 10, gaps.card - 22, 9)} fill={colors.book} fillOpacity={0.22} />
      <Path d={sparkle(width * 0.62, gaps.end + 16, 8)} fill={colors.book} fillOpacity={0.18} />
    </>}
  </Svg>;
}

const s = StyleSheet.create({
  content: { backgroundColor: colors.surface, paddingBottom: 24 },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: WASH },
  backdrop: { position: 'absolute', top: 0, left: 0 },
  outings: { marginTop: 24, paddingHorizontal: SIDE, gap: 18 },
  row: { flexDirection: 'row', justifyContent: 'center', gap: GAP },
  option: { alignItems: 'center', gap: 8 },
  optionName: { fontSize: 13, lineHeight: 16, fontWeight: '700', textAlign: 'center', color: colors.onSurface },
  // The card sits halfway between the labels above it and the tiles below: its darker base takes 5 of the gap below.
  appointments: { marginTop: CARD_GAP, paddingHorizontal: SIDE, gap: CARD_GAP + 5 },
  // A standalone deep sky-blue button raised on a darker base, like the app's stickers: today's calendar page, the
  // heading and its line, and a round white arrow.
  appointment: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: radius.lg, backgroundColor: colors.book, boxShadow: popBase(5, colors.bookDark) },
  appointmentLight: { ...StyleSheet.absoluteFill, borderRadius: radius.lg, overflow: 'hidden' },
  disc: { position: 'absolute', borderRadius: 999, backgroundColor: colors.surface },
  // Centred on the arrow (the card's padding plus half the arrow in from the right, halfway down).
  discOuter: { width: 168, height: 168, right: 36 - 84, top: '50%', marginTop: -84, opacity: 0.06 },
  discInner: { width: 96, height: 96, right: 36 - 48, top: '50%', marginTop: -48, opacity: 0.07 },
  datePage: { width: 52, height: 56, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.surface, boxShadow: popBase(3, colors.bookDark) },
  dateBand: { height: 19, paddingTop: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.electricLime },
  ringHole: { position: 'absolute', top: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: colors.forestDeep, opacity: 0.35 },
  dateMonth: { fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.forestDeep },
  dateBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dateDay: { fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.5, color: colors.book },
  appointmentGo: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  appointmentCopy: { flex: 1, gap: 2 },
  appointmentTitle: { fontSize: 18, lineHeight: 23, fontWeight: '800', letterSpacing: -0.3, color: colors.surface },
  appointmentLine: { fontSize: 12, lineHeight: 17, color: colors.surface, opacity: 0.85 },
});
