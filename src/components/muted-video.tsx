// A muted, looping video over its parent (Discover's tiles, the featured reels intro). It stays invisible until it is
// actually playing, so the photo under it shows while it loads, never a blank box.
// On the web a <video> ignores inset alone and keeps its own size (300x150, then the clip's size), so it is stretched explicitly.
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

export function MutedVideo({ source }: { source: string }) {
  const view = useRef<VideoView>(null); const [shown, setShown] = useState(false);
  const player = useVideoPlayer(source, p => { p.loop = true; p.muted = true; p.timeUpdateEventInterval = 0.5; });
  useEffect(() => {
    if (shown) return;
    const tick = player.addListener('timeUpdate', e => { if (e.currentTime > 0.2) setShown(true); });
    return () => tick.remove();
  }, [player, shown]);
  useEffect(() => {
    // Web: play() through the element so a cancelled play (scrolling past) is not reported as an error.
    // The element is not attached on the first pass, so try again once the video is ready to play.
    const start = () => {
      const element = Platform.OS === 'web' ? (view.current as unknown as { nativeRef?: { current?: HTMLVideoElement } })?.nativeRef?.current : undefined;
      if (element) void element.play().catch(() => {}); else player.play();
    };
    start();
    const ready = player.addListener('statusChange', e => { if (e.status === 'readyToPlay') start(); });
    // Android releases the player before this cleanup runs on unmount; pausing a released player throws.
    return () => { ready.remove(); try { player.pause(); } catch { /* already released */ } };
  }, [player]);
  // Android: a texture view, so the tile's rounded corners and the fade-in apply to the video too.
  return <VideoView ref={view} player={player} nativeControls={false} surfaceType="textureView" contentFit="cover" style={[StyleSheet.absoluteFill, s.video, { opacity: shown ? 1 : 0 }]} pointerEvents="none" />;
}

const s = StyleSheet.create({ video: { width: '100%', height: '100%' } });
