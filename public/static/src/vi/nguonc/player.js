/**
 * NguonC - WebView Video Player (customJS)
 *
 * Runs inside the WebView/browser context after parseChapter returns HTML.
 *
 * Priority:
 *   1. data-embed → embed iframe (reliable, handles CORS internally)
 *   2. data-m3u8  → direct HLS.js playback (fallback)
 */
(function () {
  'use strict';

  var container = document.getElementById('nguonc-player-container');
  if (!container) return;

  var inner = document.getElementById('nguonc-player-inner');
  if (!inner) return;

  // ─── Priority 1: embed iframe (most reliable) ─────────────────
  var embed = container.getAttribute('data-embed');
  if (embed) {
    console.log('[NguonC] Embedding iframe:', embed.substring(0, 80));
    showEmbed(inner, embed);
    return;
  }

  // ─── Priority 2: direct m3u8 URL ──────────────────────────────
  var m3u8 = container.getAttribute('data-m3u8');
  if (m3u8) {
    console.log('[NguonC] Playing m3u8:', m3u8.substring(0, 80) + '…');
    buildVideoPlayer(inner, [{ file: m3u8, type: 'hls' }]);
    return;
  }

  showError('Không tìm thấy nguồn phát.');

  // ─── Utilities ────────────────────────────────────────────────
  function showError(msg) {
    if (inner) {
      inner.innerHTML =
        '<p style="color:#ff4444;font-family:sans-serif;text-align:center;padding:16px;">' +
        msg +
        '</p>';
    }
  }

  function escapeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function showEmbed(target, url) {
    target.innerHTML =
      '<iframe src="' +
      escapeAttr(url) +
      '" style="width:100%;height:100%;border:none;" ' +
      'allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>';
  }

  // ─── Video player builder ────────────────────────────────────
  function buildVideoPlayer(target, sources) {
    var hlsSources = [];
    var otherSources = [];

    (sources || []).forEach(function (s) {
      var file = (s.file || '').replace(/^&http/, 'http');
      if (!file) return;
      if (s.type === 'hls' || /\.m3u8(\?|$)/i.test(file)) {
        hlsSources.push({ file: file, label: s.label || 'Auto' });
      } else {
        otherSources.push({
          file: file,
          type: s.type || 'mp4',
          label: s.label || '',
        });
      }
    });

    if (hlsSources.length === 0 && otherSources.length === 0) {
      showError('Không tìm thấy nguồn video.');
      return;
    }

    var video = document.createElement('video');
    video.controls = true;
    video.setAttribute('playsinline', '');
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.background = '#000';

    if (hlsSources.length > 0) {
      loadHlsJs(function () {
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
          var networkRetries = 0;
          var MAX_RETRIES = 2;

          var hls = new Hls({
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            xhrSetup: function (xhr) {
              xhr.withCredentials = false;
            },
          });
          hls.loadSource(hlsSources[0].file);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, function () {
            video.play().catch(function () {});
          });
          hls.on(Hls.Events.ERROR, function (event, data) {
            console.error('[NguonC HLS] error:', data.type, data.details);
            if (data.fatal) {
              if (
                data.type === Hls.ErrorTypes.NETWORK_ERROR &&
                networkRetries < MAX_RETRIES
              ) {
                networkRetries++;
                console.log(
                  '[NguonC HLS] network error, retry ' +
                    networkRetries +
                    '/' +
                    MAX_RETRIES,
                );
                hls.startLoad();
              } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                console.log('[NguonC HLS] media error, recovering…');
                hls.recoverMediaError();
              } else {
                console.log('[NguonC HLS] fatal error, destroying…');
                hls.destroy();
                showError('Lỗi phát video HLS.');
              }
            }
          });

          target.innerHTML = '';
          target.appendChild(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = hlsSources[0].file;
          video.addEventListener('loadedmetadata', function () {
            video.play().catch(function () {});
          });
          target.innerHTML = '';
          target.appendChild(video);
        } else {
          showError('Trình duyệt không hỗ trợ phát HLS.');
        }
      });
    } else {
      appendSources(video, otherSources);
      target.innerHTML = '';
      target.appendChild(video);
    }
  }

  function appendSources(video, sources) {
    sources.forEach(function (s) {
      var source = document.createElement('source');
      source.src = s.file;
      source.type = 'video/' + s.type;
      if (s.label) source.setAttribute('label', s.label);
      video.appendChild(source);
    });
  }

  function loadHlsJs(callback) {
    if (typeof Hls !== 'undefined') {
      callback();
      return;
    }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js';
    script.onload = function () {
      console.log('[NguonC] HLS.js loaded');
      callback();
    };
    script.onerror = function () {
      console.error('[NguonC] Failed to load HLS.js');
      showError('Không thể tải thư viện HLS.js.');
    };
    document.head.appendChild(script);
  }
})();
