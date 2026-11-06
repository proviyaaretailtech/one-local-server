import { useEffect, useRef, useState } from 'react';
import { useAppDimensions } from '@/src/layout';
import { View, FlatList, StyleSheet, type ViewToken } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { Reel } from '@/src/api';
import { useDiscovery } from '@/src/use-discovery';
import { colors } from '@/src/theme';
import { LoadState } from '@/src/components/catalog-sections';
import { ReelCard } from '@/src/components/reel-card';
export default function Reels() {
  const { data, isError, refetch } = useDiscovery();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [height, setHeight] = useState(useAppDimensions().height);
  const [index, setIndex] = useState(0);
  const focused = useIsFocused();
  const list = useRef<FlatList<Reel>>(null);
  useEffect(() => { if (data && focused) { const target = Math.max(0, data.findIndex(r => r.id === id)); setIndex(target); list.current?.scrollToIndex({ index: target, animated: false }); } }, [data, id, focused, height]);
  const [onViewableItemsChanged] = useState(() => ({ viewableItems }: { viewableItems: ViewToken<Reel>[] }) => { if (viewableItems.length) setIndex(viewableItems[0].index ?? 0); });
  if (!data) return <LoadState error={isError} retry={refetch} />;
  return <View testID="reels-screen" style={styles.screen} onLayout={e => setHeight(Math.round(e.nativeEvent.layout.height))}>{focused && <StatusBar style="light" />}<FlatList ref={list} testID="reels-list" data={data} keyExtractor={r => r.id} pagingEnabled snapToInterval={height} decelerationRate="fast" showsVerticalScrollIndicator={false} getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })} onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={{ itemVisiblePercentThreshold: 55 }} extraData={`${index}-${height}-${focused}`} windowSize={3} initialNumToRender={1} renderItem={({ item, index: i }) => <ReelCard reel={item} height={height} active={focused && i === index} />} /></View>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.brandPrimary } });