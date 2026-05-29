import Artplayer from '../modules/artplayer.min.cjs';
import artVi from '../modules/artplayer-i18n-vi';
import { m3u8CustomType } from './hls-custom-type';
import { setupArtplayerEvents } from './events';

export function initArtplayer(
  container: HTMLElement,
  initialUrl: string,
  initialType: string
) {
  const art = new Artplayer({
    container: container,
    url: initialUrl,
    type: initialType,
    fullscreen: true,
    fullscreenWeb: true,
    autoSize: true,
    setting: true,
    playbackRate: true,
    autoPlayback: true,
    isLive: false,
    hotkey: true,
    backdrop: true,
    lang: 'vi',
    gesture: true,
    fastForward: true,
    theme: '#fbc9ff',
    i18n: {
      vi: artVi,
    },
    customType: {
      m3u8: m3u8CustomType,
    },
  });

  // debug
  (window as any).art = art;

  setupArtplayerEvents(art);

  return art;
}
