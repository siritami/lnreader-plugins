/* eslint-disable */
/// <reference types="webview" />

/**
 * M3UPlayer – WebView customJS
 *
 * Runs inside the WebView after parseChapter returns lazy-mode HTML.
 * Reads stream config from #m3u-shaka-container data attributes,
 * loads Shaka Player from CDN, and plays MPD / DASH / FLV streams
 * (including ClearKey & Widevine DRM).
 */

const SHAKA_CDN =
  'https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/shaka-player.compiled.js';

function log(msg: string) {
  window.LNReaderPlayer!.log(msg);
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

(async function () {
  if (!window.LNReaderPlayer) return;

  const el = document.getElementById('m3u-shaka-container');
  if (!el) {
    log('No stream config found.');
    return;
  }

  const url = el.getAttribute('data-url') || '';
  const licenseType = el.getAttribute('data-license-type') || '';
  const licenseKey = el.getAttribute('data-license-key') || '';
  const userAgent = el.getAttribute('data-user-agent') || '';
  const referer = el.getAttribute('data-referer') || '';

  if (!url) {
    log('No stream URL provided.');
    return;
  }

  log('Loading Shaka Player…');

  try {
    // ── 1. Load Shaka Player from CDN ──
    if (!(window as any).shaka) {
      await loadScript(SHAKA_CDN);
    }
    const shaka = (window as any).shaka;

    // ── 2. Polyfills ──
    shaka.polyfill.installAll();

    if (!shaka.Player.isBrowserSupported()) {
      log('Browser does not support Shaka Player.');
      return;
    }

    // ── 3. Create <video> element ──
    const video = document.createElement('video');
    video.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;object-fit:contain;background:#000;z-index:9999;';
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflow = 'hidden';
    document.body.appendChild(video);

    // ── 4. Init Shaka Player ──
    const player = new shaka.Player(video);

    player.addEventListener('error', (evt: any) => {
      const err = evt.detail;
      log('Shaka error [' + err.code + ']: ' + err.message);
    });

    // ── 5. Configure DRM ──
    if (licenseType === 'clearkey' && licenseKey) {
      // Format: key_id_hex:key_hex  (from KODIPROP license_key)
      const parts = licenseKey.split(':');
      if (parts.length === 2) {
        player.configure({
          drm: {
            clearKeys: {
              [parts[0]]: parts[1],
            },
          },
        });
        log('ClearKey configured.');
      } else {
        // Might be a URL-based clearkey
        player.configure({
          drm: {
            servers: {
              'org.w3.clearkey': licenseKey,
            },
          },
        });
        log('ClearKey (URL) configured.');
      }
    } else if (licenseType === 'widevine' && licenseKey) {
      player.configure({
        drm: {
          servers: {
            'com.widevine.alpha': licenseKey,
          },
        },
      });
      log('Widevine configured → ' + licenseKey);
    }

    // ── 6. Request filters (User-Agent / Referer) ──
    if (userAgent || referer) {
      player
        .getNetworkingEngine()
        .registerRequestFilter((_type: number, request: any) => {
          if (userAgent) request.headers['User-Agent'] = userAgent;
          if (referer) {
            request.headers['Referer'] = referer;
            request.headers['Origin'] = new URL(referer).origin;
          }
        });
    }

    // ── 7. Load & play ──
    log('Loading stream…');
    await player.load(url);
    log('Stream loaded. Playing…');
    await video.play();
    log('▶ Playing!');
  } catch (err: any) {
    log('Error: ' + (err.message || String(err)));
  }
})();
