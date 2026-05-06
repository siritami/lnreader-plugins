/**
 * AnimeVietsub - WebView Video Player (customJS)
 *
 * Runs inside the WebView/browser context after parseChapter returns HTML.
 * Reads data-hash / data-id from the container div, calls /ajax/player
 * (with cookies/session available in WebView), loads HLS.js for m3u8
 * streams, and builds a video player.
 */
(function () {
  'use strict';

  var container = document.getElementById('avs-player-container');
  if (!container) return;

  var hash = container.getAttribute('data-hash');
  var id = container.getAttribute('data-id');
  var referer = container.getAttribute('data-referer');
  var site = container.getAttribute('data-site');

  if (!hash || !site) {
    showError('Thiếu thông tin tập phim.');
    return;
  }

  // Build POST body
  var body = 'link=' + encodeURIComponent(hash);
  if (id) body += '&id=' + encodeURIComponent(id);

  fetch(site + '/ajax/player', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Referer: referer || site,
    },
    body: body,
    credentials: 'include',
  })
    .then(function (res) {
      return res.json();
    })
    .then(function (json) {
      console.log('[AVS player] response:', json);

      if (!json || !json.success) {
        showError('Không lấy được link phát. Vui lòng thử lại sau.');
        return;
      }

      var inner = document.getElementById('avs-player-inner');
      if (!inner) return;

      // --- iframe player ---
      if (json.playTech === 'iframe' && typeof json.link === 'string') {
        inner.innerHTML =
          '<iframe src="' +
          escapeAttr(json.link) +
          '" style="width:100%;height:100%;border:none;" ' +
          'allowfullscreen allow="autoplay; fullscreen"></iframe>';
        return;
      }

      // --- direct sources (api / all / embed with array) ---
      if (Array.isArray(json.link)) {
        buildVideoPlayer(inner, json.link);
        return;
      }

      // --- single source string (embed / unknown) ---
      if (typeof json.link === 'string') {
        var link = json.link.replace(/^&http/, 'http');
        if (/\.m3u8(\?|$)/i.test(link)) {
          buildVideoPlayer(inner, [{ file: link, type: 'hls' }]);
        } else if (/\.(mp4|webm)(\?|$)/i.test(link)) {
          buildVideoPlayer(inner, [{ file: link }]);
        } else {
          // Assume iframe-embeddable URL
          inner.innerHTML =
            '<iframe src="' +
            escapeAttr(link) +
            '" style="width:100%;height:100%;border:none;" ' +
            'allowfullscreen allow="autoplay; fullscreen"></iframe>';
        }
        return;
      }

      showError('Định dạng phát không được hỗ trợ.');
    })
    .catch(function (err) {
      console.error('[AVS player] fetch error:', err);
      showError('Lỗi kết nối: ' + (err.message || err));
    });

  // ─── helpers ──────────────────────────────────────────

  function showError(msg) {
    var inner = document.getElementById('avs-player-inner');
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

  function buildVideoPlayer(inner, sources) {
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
      // Prefer HLS – load HLS.js dynamically
      loadHlsJs(function () {
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
          var hls = new Hls({
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
          });
          hls.loadSource(hlsSources[0].file);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, function () {
            video.play().catch(function () {});
          });
          hls.on(Hls.Events.ERROR, function (event, data) {
            console.error('[AVS HLS] error:', data);
            if (data.fatal) {
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                hls.startLoad();
              } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                hls.recoverMediaError();
              } else {
                hls.destroy();
                showError('Lỗi phát video HLS.');
              }
            }
          });
        } else if (
          video.canPlayType('application/vnd.apple.mpegurl')
        ) {
          // Safari / iOS native HLS support
          video.src = hlsSources[0].file;
          video.addEventListener('loadedmetadata', function () {
            video.play().catch(function () {});
          });
        } else {
          // Cannot play HLS, try mp4 fallback
          if (otherSources.length > 0) {
            appendMp4Sources(video, otherSources);
          } else {
            showError('Trình duyệt không hỗ trợ phát HLS.');
            return;
          }
        }

        inner.innerHTML = '';
        inner.appendChild(video);
      });
    } else {
      // MP4 / WebM sources only
      appendMp4Sources(video, otherSources);
      inner.innerHTML = '';
      inner.appendChild(video);
    }
  }

  function appendMp4Sources(video, sources) {
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
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js';
    script.onload = function () {
      console.log('[AVS player] HLS.js loaded');
      callback();
    };
    script.onerror = function () {
      console.error('[AVS player] Failed to load HLS.js');
      showError('Không thể tải thư viện HLS.js.');
    };
    document.head.appendChild(script);
  }
})();
