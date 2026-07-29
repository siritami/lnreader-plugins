/* eslint-disable */
/// <reference types="webview" />

/**
 * YanHH3D - WebView Video Player (customJS)
 *
 * Renders quality selection buttons below the player and plays via HLS.js.
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

/** Play a URL through LNReaderPlayer based on its extension */
function playUrl(url: string, player: LNReaderPlayerAPI) {
  if (/\.m3u8(\?|$)/i.test(url)) {
    log('Playing HLS: ' + url);
    player.playHls(url);
  } else if (/\.(mp4|webm|mkv)(\?|$)/i.test(url)) {
    log('Playing direct: ' + url);
    player.playDirect(url);
  } else {
    // fbcdn URLs without extension — treat as HLS
    log('Playing as HLS (no ext): ' + url);
    player.playHls(url);
  }
}

/** Build and inject quality selection buttons below the player */
function renderQualityButtons(
  servers: { label: string; url: string }[],
  activeUrl: string,
  player: LNReaderPlayerAPI,
) {
  // Remove existing bar if re-rendering
  const existing = document.getElementById('yanhh3d-quality-bar');
  if (existing) existing.remove();

  const bar = document.createElement('div');
  bar.id = 'yanhh3d-quality-bar';
  bar.style.cssText =
    'display:flex;gap:6px;padding:8px 12px;background:#1a1a2e;border-radius:6px;flex-wrap:wrap;justify-content:center;';

  // Style for each button
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
      // Update active state on all buttons
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

    // Hover effect
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

  // Insert after the player container
  const playerContainer = document.querySelector('.lnr-chapter-content');
  if (playerContainer && playerContainer.parentNode) {
    playerContainer.parentNode.insertBefore(bar, playerContainer.nextSibling);
  } else {
    // Fallback: append to body
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

  // Parse all servers
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

  // Pick best URL: explicit data-m3u8 > first in list
  const bestUrl = m3u8Url || (servers.length > 0 ? servers[0].url : null);

  if (!bestUrl) {
    showError('No video source found');
    return;
  }

  // Play the best quality
  playUrl(bestUrl, player);

  // Render quality buttons if more than 1 server
  if (servers.length > 1) {
    // Small delay to let the player initialize its DOM
    setTimeout(() => {
      renderQualityButtons(servers, bestUrl, player);
    }, 500);
  }
}

initPlayer();
