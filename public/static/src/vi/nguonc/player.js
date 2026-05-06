/**
 * NguonC - WebView Video Player (customJS)
 *
 * Runs inside the WebView/browser context after parseChapter returns HTML.
 * Uses embed iframe for playback.
 */
(function () {
  'use strict';

  var container = document.getElementById('nguonc-player-container');
  if (!container) return;

  var inner = document.getElementById('nguonc-player-inner');
  if (!inner) return;

  var embed = container.getAttribute('data-embed');
  if (embed) {
    console.log('[NguonC] Embedding iframe:', embed.substring(0, 80));
    inner.innerHTML =
      '<iframe src="' +
      embed.replace(/&/g, '&amp;').replace(/"/g, '&quot;') +
      '" style="width:100%;height:100%;border:none;" ' +
      'allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>';
  } else {
    inner.innerHTML =
      '<p style="color:#ff4444;font-family:sans-serif;text-align:center;padding:16px;">' +
      'Không tìm thấy nguồn phát.</p>';
  }
})();