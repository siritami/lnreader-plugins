/**
 * AnimeVietsub - WebView Video Player (customJS)
 *
 * Runs inside the WebView/browser context after parseChapter returns HTML.
 *
 * Priority:
 *   1. data-m3u8   → direct HLS.js playback (bypasses iframe adblock detection)
 *   2. data-sources → direct source playback
 *   3. data-iframe  → embed iframe
 *   4. data-hash    → AJAX /ajax/player fallback
 */
(function () {
  'use strict';

  var container = document.getElementById('avs-player-container');
  if (!container) return;

  var inner = document.getElementById('avs-player-inner');
  if (!inner) return;

  // ─── Priority 1: direct m3u8 URL (from parseChapter extraction) ──
  var m3u8 = container.getAttribute('data-m3u8');
  if (m3u8) {
    console.log('[AVS] Playing m3u8 directly:', m3u8.substring(0, 80) + '…');
    buildVideoPlayer(inner, [{ file: m3u8, type: 'hls' }]);
    return;
  }

  // ─── Priority 2: pre-parsed sources array ────────────────────────
  var sourcesRaw = container.getAttribute('data-sources');
  if (sourcesRaw) {
    try {
      var sources = JSON.parse(sourcesRaw);
      console.log('[AVS] Playing parsed sources:', sources.length);
      buildVideoPlayer(inner, sources);
      return;
    } catch (e) {
      console.warn('[AVS] Failed to parse data-sources:', e);
    }
  }

  // ─── Priority 3: iframe embed ────────────────────────────────────
  var iframeSrc = container.getAttribute('data-iframe');
  if (iframeSrc) {
    console.log('[AVS] Embedding iframe:', iframeSrc.substring(0, 80));
    inner.innerHTML =
      '<iframe src="' +
      escapeAttr(iframeSrc) +
      '" style="width:100%;height:100%;border:none;" ' +
      'allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>';
    return;
  }

  // ─── Priority 4: AJAX fallback with data-hash ────────────────────
  var hash = container.getAttribute('data-hash');
  var id = container.getAttribute('data-id');
  var referer = container.getAttribute('data-referer');
  var site = container.getAttribute('data-site');

  if (!hash || !site) {
    showError('Thiếu thông tin tập phim.');
    return;
  }

  callAjaxPlayer();

  function callAjaxPlayer() {
    var postBody = 'link=' + encodeURIComponent(hash);
    if (id) postBody += '&id=' + encodeURIComponent(id);

    console.log('[AVS] AJAX fallback: calling /ajax/player…');
    fetch(site + '/ajax/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: referer || site + '/',
        Origin: site,
      },
      body: postBody,
      credentials: 'include',
    })
      .then(function (res) {
        return res.text();
      })
      .then(function (text) {
        console.log('[AVS] /ajax/player response:', text.slice(0, 300));

        var json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          console.warn('[AVS] Non-JSON response');
          showError('Không thể phân tích phản hồi từ server.');
          return;
        }

        if (!json || !json.success) {
          showError('Server trả về lỗi.');
          return;
        }

        handlePlayerResponse(json);
      })
      .catch(function (err) {
        console.error('[AVS] /ajax/player error:', err);
        showError('Không thể kết nối tới server.');
      });
  }

  function handlePlayerResponse(json) {
    // iframe player
    if (json.playTech === 'iframe' && typeof json.link === 'string') {
      inner.innerHTML =
        '<iframe src="' +
        escapeAttr(json.link) +
        '" style="width:100%;height:100%;border:none;" ' +
        'allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>';
      return;
    }

    // sources array
    if (Array.isArray(json.link)) {
      buildVideoPlayer(inner, json.link);
      return;
    }

    // single source string
    if (typeof json.link === 'string') {
      var link = json.link.replace(/^&http/, 'http');
      if (/\.m3u8(\?|$)/i.test(link)) {
        buildVideoPlayer(inner, [{ file: link, type: 'hls' }]);
      } else if (/\.(mp4|webm)(\?|$)/i.test(link)) {
        buildVideoPlayer(inner, [{ file: link }]);
      } else {
        inner.innerHTML =
          '<iframe src="' +
          escapeAttr(link) +
          '" style="width:100%;height:100%;border:none;" ' +
          'allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>';
      }
      return;
    }

    showError('Định dạng phát không được hỗ trợ.');
  }

  // ─── Utilities ──────────────────────────────────────────────────
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

  // ─── Video player builder ──────────────────────────────────────
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
            console.error('[AVS HLS] error:', data.type, data.details);
            if (data.fatal) {
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                console.log('[AVS HLS] network error, retrying…');
                hls.startLoad();
              } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                console.log('[AVS HLS] media error, recovering…');
                hls.recoverMediaError();
              } else {
                hls.destroy();
                if (otherSources.length > 0) {
                  appendMp4Sources(video, otherSources);
                } else {
                  showError('Lỗi phát video HLS.');
                }
              }
            }
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = hlsSources[0].file;
          video.addEventListener('loadedmetadata', function () {
            video.play().catch(function () {});
          });
        } else if (otherSources.length > 0) {
          appendMp4Sources(video, otherSources);
        } else {
          showError('Trình duyệt không hỗ trợ phát HLS.');
          return;
        }

        target.innerHTML = '';
        target.appendChild(video);
      });
    } else {
      appendMp4Sources(video, otherSources);
      target.innerHTML = '';
      target.appendChild(video);
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
      console.log('[AVS] HLS.js loaded');
      callback();
    };
    script.onerror = function () {
      console.error('[AVS] Failed to load HLS.js');
      showError('Không thể tải thư viện HLS.js.');
    };
    document.head.appendChild(script);
  }
})();
