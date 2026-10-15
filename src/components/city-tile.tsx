// A popular-city card on the location picker: the city's landmark photo, faded behind a colour gradient (the way food apps draw
// their city grids), with the name and state in white at the bottom. Photos are small (480 px) JPEGs from Wikimedia Commons;
// credits are in assets/images/cities/CREDITS.md. A city with no photo gets the gradient alone.
import { ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

type City = { image?: number; from: string; to: string };

// Each city has its own colour so the grid is not one flat block. The photo shows through at about half strength.
const CITIES: Record<string, City> = {
  mumbai: { image: require('../../assets/images/cities/mumbai.jpg'), from: '#0F3D66', to: '#1B7FBF' },
  delhi: { image: require('../../assets/images/cities/delhi.jpg'), from: '#7A2E12', to: '#E07A2F' },
  bengaluru: { image: require('../../assets/images/cities/bengaluru.jpg'), from: '#0E5A3A', to: '#2FA36B' },
  hyderabad: { image: require('../../assets/images/cities/hyderabad.jpg'), from: '#5B2A86', to: '#A55FD6' },
  chennai: { image: require('../../assets/images/cities/chennai.jpg'), from: '#8A1F3D', to: '#D9476A' },
  kolkata: { image: require('../../assets/images/cities/kolkata.jpg'), from: '#7A5A00', to: '#D6A21E' },
  pune: { image: require('../../assets/images/cities/pune.jpg'), from: '#1F4D78', to: '#4F8FCB' },
  ahmedabad: { image: require('../../assets/images/cities/ahmedabad.jpg'), from: '#7A3B10', to: '#CC7A3A' },
  jaipur: { image: require('../../assets/images/cities/jaipur.jpg'), from: '#8C1F4A', to: '#E0638F' },
};
const FALLBACK: City = { from: '#1E5A3A', to: '#3FA672' };

export function CityTile({ name, state, onPress, testID }: { name: string; state: string; onPress: () => void; testID?: string }) {
  const city = CITIES[name.toLowerCase()] ?? FALLBACK;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${name}, ${state}`} onPress={onPress} style={({ pressed }) => [s.tile, pressed && s.pressed]}>
      <LinearGradient colors={[city.from, city.to]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      {city.image != null && <ImageBackground source={city.image} resizeMode="cover" style={[StyleSheet.absoluteFill, s.photo]} accessibilityElementsHidden importantForAccessibility="no" />}
      {/* the colour comes back over the photo from the bottom, so the white text always reads */}
      <LinearGradient colors={['rgba(0,0,0,0)', city.from + 'E6']} start={{ x: 0.5, y: 0.2 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={s.copy}>
        <Text style={s.name} numberOfLines={1}>{name}</Text>
        <Text style={s.state} numberOfLines={1}>{state}</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  tile: { width: '30%', flexGrow: 1, minHeight: 104, borderRadius: 18, overflow: 'hidden', justifyContent: 'flex-end' },
  photo: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  copy: { padding: 12 },
  name: { fontSize: 14, fontWeight: '800', color: '#FFFFFF', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  state: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
});
