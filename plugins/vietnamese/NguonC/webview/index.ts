/* eslint-disable */
/// <reference types="webview" />

/**
 * NguonC - WebView Video Player
 *
 * Loads the embed page's player.js and lets it handle decryption natively.
 * Captures the decrypted m3u8 blob URL and plays via LNReaderPlayer.playHls().
 *
 * Fallback: playIframe if player.js fails.
 */

const createProxyFragLoader = (origin: string) => {
  return class ProxyFragLoader {
    private _config: any;
    private context: any = null;
    private _controller: AbortController | null = null;
    stats = {
      aborted: false,
      loaded: 0,
      retry: 0,
      total: 0,
      chunkCount: 0,
      bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 },
      parsing: { start: 0, end: 0 },
      buffering: { start: 0, first: 0, end: 0 },
    };

    constructor(config: any) {
      this._config = config;
    }

    destroy() {
      this.abort();
    }

    abort() {
      if (this._controller) {
        this._controller.abort();
        this._controller = null;
      }
    }

    load(ctx: any, _cfg: any, cbs: any) {
      this.context = ctx;
      this.stats.loading.start = performance.now();

      window.reader
        .fetch(ctx.url, {
          method: 'GET',
          headers: { Referer: origin },
          referrer: origin,
        })
        .then((resp: any) => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          this.stats.loading.first = performance.now();
          return resp.arrayBuffer();
        })
        .then((buf: any) => {
          this.stats.loading.end = performance.now();
          this.stats.loaded = buf.byteLength;
          this.stats.total = buf.byteLength;
          cbs.onSuccess({ data: buf }, this.stats, ctx, null);
        })
        .catch((err: any) => {
          if (err.name === 'AbortError') return;
          this.stats.loading.end = performance.now();
          cbs.onError({ code: 0, text: err.message }, ctx, null, this.stats);
        });
    }
  };
};

(async () => {
  console.log('[NGC] Webview script loaded');
  const player = window.LNReaderPlayer;
  if (!player) return;

  const container = document.getElementById('nguonc-player-container');
  if (!container) return;

  const embedUrl = container.getAttribute('data-iframe');
  const dataObf = container.getAttribute('data-obf');

  if (!embedUrl || !dataObf) {
    player.log('[NGC] Missing data attributes');
    return;
  }

  try {
    const embedOrigin = new URL(embedUrl).origin;

    // ── 1. Set up DOM for player.js ──
    const playerDiv = document.createElement('div');
    playerDiv.id = 'player';
    playerDiv.setAttribute('data-obf', dataObf);
    playerDiv.style.display = 'none';
    document.body.appendChild(playerDiv);

    // ── 2. Set globals BEFORE player.js runs ──
    const streamData = JSON.parse(atob(dataObf));
    (window as any).streamURL = streamData.sUb;
    (window as any).videoHash = streamData.hD;
    (window as any).devtoolsDetector = {
      launch() {},
      addListener() {},
      detect() {
        return false;
      },
    };

    // ── 3. Mock JWPlayer (player.js needs it to not crash) ──
    const mockJwp: any = function () {
      return {
        setup() {},
        on() {},
        once() {},
        play() {},
        pause() {},
        stop() {},
        getPlaylistItem() {
          return {};
        },
        getPosition() {
          return 0;
        },
        getDuration() {
          return 0;
        },
        getState() {
          return 'idle';
        },
        remove() {},
        setVolume() {},
        setMute() {},
        fullscreen() {},
        getAudioTracks() {
          return [];
        },
        getCurrentAudioTrack() {
          return 0;
        },
        setCurrentAudioTrack() {},
        getCaptionsList() {
          return [];
        },
        getCurrentCaption() {
          return 0;
        },
        setCaptions() {},
      };
    };
    mockJwp.defaults = {};
    (window as any).jwplayer = mockJwp;

    // ── 4. Hook URL.createObjectURL to capture decrypted m3u8 blob ──
    const origCreateObjectURL = URL.createObjectURL;
    let capturedM3u8Url: string | null = null;

    URL.createObjectURL = function (blob: any) {
      const url = origCreateObjectURL.call(URL, blob);
      if (blob instanceof Blob && !capturedM3u8Url) {
        blob
          .text()
          .then((text: string) => {
            if (
              text.includes('#EXTINF') ||
              text.includes('#EXTM3U') ||
              text.includes('#EXT-X-VERSION')
            ) {
              capturedM3u8Url = url;
              player.log(
                '[NGC] Captured decrypted m3u8 (' + text.length + ' chars)',
              );
              player.playHls(url, {
                fLoader: createProxyFragLoader(embedOrigin),
              });
              player.log('[NGC] playHls called');
            }
          })
          .catch(() => {});
      }
      return url;
    } as typeof URL.createObjectURL;

    // ── 5. Fetch player.js from embed origin ──
    player.log('[NGC] Fetching player.js...');
    const playerJsUrl = embedOrigin + '/player.js?ver=1.7';
    const resp = await window.reader.fetch(playerJsUrl, { method: 'GET' });
    const playerJsSource = await resp.text();
    player.log(
      '[NGC] player.js loaded (' + playerJsSource.length + ' chars)',
    );

    // ── 6. Override fetch → window.reader.fetch ──
    //    player.js uses native fetch which may be CORS-blocked.
    //    Redirect to window.reader.fetch with absolute URLs.
    //    Only pass method/headers/body — strip signal, mode, credentials etc.
    //    that reader.fetch doesn't support (signal causes "aborted without reason").
    const origFetch = window.fetch;
    const fetchLog: string[] = [];
    (window as any).fetch = function (input: any, init?: any) {
      let url =
        typeof input === 'string' ? input : input?.url || String(input);
      // Convert relative URLs to absolute
      if (!url.startsWith('http')) {
        url = embedOrigin + (url.startsWith('/') ? url : '/' + url);
      }
      const method = init?.method || 'GET';
      const logEntry = method + ' ' + url.substring(0, 120);
      fetchLog.push(logEntry);
      player.log('[NGC] fetch → ' + logEntry);

      // Build headers — remove x-auth (not needed, reader.fetch may not support it)
      let headers: Record<string, string> = {};
      if (init?.headers) {
        const hdrs = init.headers as Record<string, string>;
        for (const k of Object.keys(hdrs)) {
          if (k.toLowerCase() !== 'x-auth') headers[k] = hdrs[k];
        }
      }

      // Only pass safe options — strip signal/mode/credentials/redirect etc.
      const safeInit: Record<string, any> = { method, headers };
      if (init?.body !== undefined) safeInit.body = init.body;

      return window.reader
        .fetch(url, safeInit)
        .then(async (r: any) => {
          // Wrap into a minimal Response-like object so player.js .ok/.text() work
          const status = r.status ?? 200;
          const ok = r.ok ?? (status >= 200 && status < 300);
          const respHeaders: Record<string, string> = {};
          if (r.headers?.forEach) {
            r.headers.forEach((v: string, k: string) => {
              respHeaders[k] = v;
            });
          }
          const body = await r.text();
          player.log(
            '[NGC] fetch ← ' + status + ' (' + body.length + ' chars)',
          );
          return {
            ok,
            status,
            headers: respHeaders,
            text: () => Promise.resolve(body),
            json: () => Promise.resolve(JSON.parse(body)),
            arrayBuffer: () =>
              Promise.resolve(
                new TextEncoder().encode(body).buffer,
              ),
            clone() {
              return this;
            },
          };
        })
        .catch((err: any) => {
          player.log('[NGC] fetch error: ' + err.message);
          throw err;
        });
    };

    // ── 7. Inject player.js via <script> tag (global scope, like real embed) ──
    //    eval() runs in local scope which breaks the obfuscated rotation IIFE.
    //    A <script> tag runs in global scope, matching real embed page behavior.
    player.log('[NGC] Injecting player.js via <script> tag...');
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.textContent = playerJsSource;
      s.onload = () => {
        player.log('[NGC] player.js script loaded OK');
        resolve();
      };
      s.onerror = (e) => {
        player.log('[NGC] player.js script load error');
        reject(new Error('script tag onerror'));
      };
      document.head.appendChild(s);
    });

    // ── 8. Fire DOMContentLoaded so player.js listeners trigger ──
    //    In the real embed page player.js is <script defer> and the DOM
    //    is ready when it runs. Here the DOM is already loaded, so
    //    any DOMContentLoaded handlers registered by player.js would
    //    never fire. Dispatch the event to kick them off.
    player.log('[NGC] Dispatching DOMContentLoaded...');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    // ── 9. Wait for decryption (poll for captured blob URL) ──
    let attempts = 0;
    const maxWaitMs = 25000;
    const pollMs = 500;
    while (!capturedM3u8Url && attempts * pollMs < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollMs));
      attempts++;
      if (attempts % 4 === 0) {
        player.log(
          '[NGC] Waiting... (' +
            (attempts * pollMs / 1000).toFixed(1) +
            's, fetches: ' +
            fetchLog.length +
            ')',
        );
      }
    }

    // ── 10. Cleanup ──
    (window as any).fetch = origFetch;
    URL.createObjectURL = origCreateObjectURL;

    if (capturedM3u8Url) {
      player.log('[NGC] Decryption succeeded via player.js');
    } else {
      player.log(
        '[NGC] Timeout (' + fetchLog.length + ' fetch calls). Falling back to iframe',
      );
      player.playIframe(embedUrl);
    }
  } catch (err: any) {
    player.log('[NGC] Error: ' + (err?.message || err));
    if (embedUrl) player.playIframe(embedUrl);
  }
})();
