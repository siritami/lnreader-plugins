/* eslint-disable */
/// <reference types="webview" />

/**
 * M3UPlayer – WebView customJS
 *
 * Runs inside the WebView after parseChapter returns lazy-mode HTML.
 * Reads stream config from #m3u-shaka-container data attributes,
 * loads Shaka Player locally, and plays MPD / DASH / FLV streams
 * (including ClearKey & Widevine DRM).
 *
 * Shaka Player docs: https://shaka-project.github.io/shaka-player/docs/api/tutorial-basic-usage.html
 */

// @ts-ignore – side-effect import: sets window.shaka
import './shaka-player.compiled.js';

const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function log(msg: string) {
  try {
    window.LNReaderPlayer!.log(msg);
  } catch (_) {
    console.log('[M3UPlayer] ' + msg);
  }
}

function showError(msg: string) {
  log('ERROR: ' + msg);
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'color:#fff;background:rgba(0,0,0,0.85);padding:20px 30px;border-radius:12px;' +
    'font:16px/1.4 sans-serif;z-index:10000;text-align:center;max-width:90vw;word-break:break-word;';
  overlay.textContent = msg;
  document.body.appendChild(overlay);
}

function getShaka(): any {
  return (window as any).shaka;
}

(async function () {
  const el = document.getElementById('m3u-shaka-container');
  if (!el) {
    showError('No stream config found.');
    return;
  }

  const url = el.getAttribute('data-url') || '';
  const licenseType = el.getAttribute('data-license-type') || '';
  const licenseKey = el.getAttribute('data-license-key') || '';
  // Always use a User-Agent – CDNs reject requests without one
  const userAgent = el.getAttribute('data-user-agent') || DEFAULT_UA;
  const referer = el.getAttribute('data-referer') || '';

  if (!url) {
    showError('No stream URL provided.');
    return;
  }

  log('URL: ' + url);
  log('License type: ' + (licenseType || 'none'));
  log('License key: ' + (licenseKey || 'none'));
  log('UA: ' + userAgent);
  log('Initializing Shaka Player…');

  try {
    const shaka = getShaka();
    if (!shaka) {
      showError('Shaka Player not loaded. Check bundle.');
      return;
    }

    // ── 1. Install polyfills (must be called before anything else) ──
    shaka.polyfill.installAll();

    if (!shaka.Player.isBrowserSupported()) {
      showError('Browser does not support Shaka Player.');
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
    const player = new shaka.Player(video);

    // ── 4. Listen for errors ──
    player.addEventListener('error', (evt: any) => {
      const err = evt.detail;
      const code = err.code || 'unknown';
      const message = err.message || JSON.stringify(err);
      showError('Shaka error [' + code + ']: ' + message);
    });

    // ── 5. Configure DRM ──
    if (licenseType === 'clearkey' && licenseKey) {
      const parts = licenseKey.split(':');
      if (parts.length === 2) {
        player.configure({
          drm: {
            clearKeys: {
              [parts[0]]: parts[1],
            },
          },
        });
        log('ClearKey configured (inline key:pair).');
      } else {
        player.configure({
          drm: {
            servers: {
              'org.w3.clearkey': licenseKey,
            },
          },
        });
        log('ClearKey configured (server URL).');
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
    // Always register to add headers to ALL requests (manifest + segments + license)
    player
      .getNetworkingEngine()
      .registerRequestFilter((type: number, request: any) => {
        // Always set User-Agent (CDNs reject requests without one)
        request.headers['User-Agent'] = userAgent;
        if (referer) {
          request.headers['Referer'] = referer;
          try {
            request.headers['Origin'] = new URL(referer).origin;
          } catch (_) {
            /* ignore */
          }
        }
        // For license requests, ensure proper Content-Type
        if (type === 6) {
          // NetworkingEngine.RequestType.LICENSE = 6
          request.headers['Content-Type'] = request.headers['Content-Type'] || 'application/octet-stream';
          log('License request → ' + (request.uris?.[0] || request.url || 'unknown'));
        }
      });

    // Log responses for debugging
    player
      .getNetworkingEngine()
      .registerResponseFilter((type: number, response: any) => {
        const status = response.status || response.code || 'unknown';
        log('Response type=' + type + ' status=' + status + ' uri=' + (response.uri || ''));
        if (type === 6) {
          log('License response status: ' + status);
        }
      });

    // ── 7. Load manifest & play ──
    log('Loading: ' + url);
    await player.load(url);
    log('Loaded! Playing…');
    await video.play();
    log('▶ Playing!');
  } catch (err: any) {
    const code = err.code || '';
    const message = err.message || String(err);
    showError('Failed to load stream: Shaka Error ' + code + '\n' + message);
  }
})();
