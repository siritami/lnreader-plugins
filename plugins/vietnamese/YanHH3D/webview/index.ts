/* eslint-disable */
/// <reference types="webview" />

/**
 * YanHH3D - WebView Video Player (customJS)
 *
 * Uses window.reader.fetch (bypasses CORS) for BOTH manifest and segment
 * loading via custom HLS.js loaders. No URL rewriting needed.
 *
 * Container data attributes:
 *   data-m3u8  → default (highest) m3u8 URL
 *   data-all   → JSON array of all servers [{label, url}]
 *   data-debug → '1' to enable debug logging
 */

function log(msg: string) {
  window.LNReaderPlayer?.log('[YHH3D] ' + msg);
  console.log('[YHH3D] ' + msg);
}

function showError(msg: string) {
  log('ERROR: ' + msg);
}

/**
 * Create a custom HLS.js loader (works for both fLoader and pLoader)
 * that proxies ALL requests through window.reader.fetch with Referer header.
 */
function createProxyLoader(referer: string) {
  return class {
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
    constructor() {}
    destroy() {}
    abort() {}
    load(ctx: any, _cfg: any, cbs: any) {
      this.stats.loading.start = performance.now();
      window.reader
        .fetch(ctx.url, {
          method: 'GET',
          headers: { Referer: referer },
          referrer: referer,
        })
        .then((resp: any) => {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
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
          this.stats.loading.end = performance.now();
          cbs.onError(
            { code: 0, text: err.message },
            ctx,
            null,
            this.stats,
          );
        });
    }
  };
}

/** Play an m3u8 URL through LNReaderPlayer with proxy loaders */
function playM3u8(url: string, player: LNReaderPlayerAPI) {
  let referer = '';
  try {
    referer = new URL(url).origin + '/';
  } catch {
    referer = 'https://yanhh3d.love/';
  }

  const loader = createProxyLoader(referer);
  log('Playing HLS via proxy loader: ' + url);
  player.playHls(url, {
    fLoader: loader,
    pLoader: loader,
  } as any);
}

/** Play a URL based on its format */
function playUrl(url: string, player: LNReaderPlayerAPI) {
  if (/\.m3u8(\?|$)/i.test(url) || !/\.(mp4|webm|mkv)(\?|$)/i.test(url)) {
    playM3u8(url, player);
  } else {
    log('Playing direct: ' + url);
    player.playDirect(url);
  }
}

/** Build and inject quality selection buttons below the player */
function renderQualityButtons(
  servers: { label: string; url: string }[],
  activeUrl: string,
  player: LNReaderPlayerAPI,
) {
  const existing = document.getElementById('yanhh3d-quality-bar');
  if (existing) existing.remove();

  const bar = document.createElement('div');
  bar.id = 'yanhh3d-quality-bar';
  bar.style.cssText =
    'display:flex;gap:6px;padding:8px 12px;background:#1a1a2e;border-radius:6px;flex-wrap:wrap;justify-content:center;';

  const baseStyle =
    'padding:5px 14px;border:1px solid #444;border-radius:4px;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;';

  servers.forEach(s => {
    const btn = document.createElement('button');
    const isActive = s.url === activeUrl;
    btn.textContent = s.label;
    btn.style.cssText =
      baseStyle +
      (isActive
        ? 'background:#e94560;color:#fff;border-color:#e94560;'
        : 'background:#16213e;color:#aaa;border-color:#444;');

    btn.addEventListener('click', () => {
      bar.querySelectorAll('button').forEach(b => {
        b.style.background = '#16213e';
        b.style.color = '#aaa';
        b.style.borderColor = '#444';
      });
      btn.style.background = '#e94560';
      btn.style.color = '#fff';
      btn.style.borderColor = '#e94560';
      log('Switching to: ' + s.label);
      playUrl(s.url, player);
    });

    btn.addEventListener('mouseenter', () => {
      if (btn.style.background !== 'rgb(233, 69, 96)') {
        btn.style.borderColor = '#e94560';
        btn.style.color = '#ddd';
      }
    });
    btn.addEventListener('mouseleave', () => {
      if (btn.style.background !== 'rgb(233, 69, 96)') {
        btn.style.borderColor = '#444';
        btn.style.color = '#aaa';
      }
    });

    bar.appendChild(btn);
  });

  const playerContainer = document.querySelector('.lnr-chapter-content');
  if (playerContainer && playerContainer.parentNode) {
    playerContainer.parentNode.insertBefore(bar, playerContainer.nextSibling);
  } else {
    document.body.appendChild(bar);
  }
}

async function initPlayer() {
  const container = document.getElementById('yanhh3d-player-container');
  if (!container) {
    showError('Player container not found');
    return;
  }

  const player = window.LNReaderPlayer;
  if (!player) {
    showError('LNReaderPlayer API not available');
    return;
  }

  const debugEnabled = container.getAttribute('data-debug') === '1';
  const m3u8Url = container.getAttribute('data-m3u8');
  const allServersRaw = container.getAttribute('data-all');

  let servers: { label: string; url: string }[] = [];
  if (allServersRaw) {
    try {
      servers = JSON.parse(allServersRaw);
    } catch (e) {
      log('Warning: Failed to parse data-all JSON');
    }
  }

  if (debugEnabled) {
    log('=== DEBUG INFO ===');
    log('Container: YES');
    log('Default m3u8: ' + (m3u8Url || 'none'));
    log('Servers (' + servers.length + '):');
    servers.forEach((s, i) => log(`  [${i}] ${s.label} → ${s.url}`));
    log('==================');
  }

  const bestUrl = m3u8Url || (servers.length > 0 ? servers[0].url : null);

  if (!bestUrl) {
    showError('No video source found');
    return;
  }

  playUrl(bestUrl, player);

  if (servers.length > 1) {
    setTimeout(() => {
      renderQualityButtons(servers, bestUrl, player);
    }, 500);
  }
}

initPlayer();
