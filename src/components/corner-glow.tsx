// Soft radial glow tucked into a corner of a card or screen — the "corner gradient" accent.
// Drawn with SVG so it's a true radial falloff (no hard edges) on iOS, Android and web.
import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export function CornerGlow({ color, corner = 'top-right', size = 220, strength = 0.35 }: { color: string; corner?: Corner; size?: number; strength?: number }) {
  const id = `glow${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [v, h] = corner.split('-') as ['top' | 'bottom', 'left' | 'right'];
  return <View pointerEvents="none" style={[s.wrap, { width: size, height: size, [v]: -size / 2, [h]: -size / 2 }]}>
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={strength} />
          <Stop offset="0.55" stopColor={color} stopOpacity={strength * 0.35} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={size} height={size} fill={`url(#${id})`} />
    </Svg>
  </View>;
}

const s = StyleSheet.create({ wrap: { position: 'absolute' } });
