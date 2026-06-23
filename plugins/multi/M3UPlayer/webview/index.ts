/* eslint-disable */
/// <reference types="webview" />

/**
 * M3UPlayer – WebView customJS
 *
 * Runs inside the WebView after parseChapter returns lazy-mode HTML.
 * Reads stream config from #m3u-shaka-container data attributes,
 * loads Shaka Player from CDN, and plays MPD / DASH / FLV streams
 * (including ClearKey & Widevine DRM).
 *
 * Shaka Player docs: https://shaka-project.github.io/shaka-player/docs/api/tutorial-basic-usage.html
 */

// @ts-ignore – side-effect import: sets window.shaka
import './shaka-player.compiled.js';

function log(msg: string) {
  window.LNReaderPlayer!.log(msg);
}

function getShaka(): any {
  return (window as any).shaka;
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

  log('Initializing Shaka Player…');

  try {
    const shaka = getShaka();
    if (!shaka) {
      log('Shaka Player not loaded.');
      return;
    }

    // ── 1. Install polyfills (must be called before anything else) ──
    shaka.polyfill.installAll();

    if (!shaka.Player.isBrowserSupported()) {
      log('Browser does not support Shaka Player.');
      return;
    }

    // ── 2. Create <video> element ──
    const video = document.createElement('video');
    video.id = 'shaka-video';
    video.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;object-fit:contain;background:#000;z-index:9999;';
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('controls', '');
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflow = 'hidden';
    document.body.appendChild(video);

    // ── 3. Create Player (attach to video element) ──
    // Per docs: new shaka.Player(mediaElement) attaches automatically
    const player = new shaka.Player(video);

    // ── 4. Listen for errors ──
    player.addEventListener('error', (evt: any) => {
      const err = evt.detail;
      log('Shaka error [' + err.code + ']: ' + err.message);
    });

    // ── 5. Configure DRM ──
    // Per docs: https://shaka-project.github.io/shaka-player/docs/api/tutorial-drm-config.html
    if (licenseType === 'clearkey' && licenseKey) {
      // Format: key_id_hex:key_hex  (from KODIPROP license_key)
      const parts = licenseKey.split(':');
      if (parts.length === 2) {
        // ClearKey with inline keys (hex key-id → hex key)
        player.configure({
          drm: {
            clearKeys: {
              [parts[0]]: parts[1],
            },
          },
        });
        log('ClearKey configured (inline).');
      } else {
        // ClearKey via license server URL
        player.configure({
          drm: {
            servers: {
              'org.w3.clearkey': licenseKey,
            },
          },
        });
        log('ClearKey configured (server).');
      }
    } else if (licenseType === 'widevine' && licenseKey) {
      // Widevine license server
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
            try {
              request.headers['Origin'] = new URL(referer).origin;
            } catch (_) {
              /* ignore invalid referer */
            }
          }
        });
    }

    // ── 7. Load manifest & play ──
    log('Loading stream: ' + url);
    await player.load(url);
    log('Stream loaded. Starting playback…');
    await video.play();
    log('▶ Playing!');
  } catch (err: any) {
    log('Error: ' + (err.message || String(err)));
  }
})();
