/**
 * AnimeVietsub - WebView Video Player (customJS)
 *
 * Runs inside the WebView/browser context after parseChapter returns HTML.
 * Only handles data-m3u8 → direct HLS.js playback.
 */
(function () {
  'use strict';

  var container = document.getElementById('avs-player-container');
  if (!container) return;

  var inner = document.getElementById('avs-player-inner');
  if (!inner) return;

  var m3u8 = container.getAttribute('data-m3u8');
  if (!m3u8) {
    showError('Không tìm thấy URL m3u8.');
    return;
  }

  console.log('[AVS] Playing m3u8 directly:', m3u8.substring(0, 80) + '…');

  var video = document.createElement('video');
  video.controls = true;
  video.setAttribute('playsinline', '');
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.background = '#000';

  // --- Đồng bộ tiến độ xem với app gốc ---
  var hasSeekedInitial = false;
  var lastSaveTime = 0;

  video.addEventListener('loadedmetadata', function () {
    try {
      if (!hasSeekedInitial && video.duration > 0 && window.reader && window.reader.chapter) {
        var initialProgress = window.reader.chapter.progress || 0;
        if (initialProgress > 0 && initialProgress < 100) {
          video.currentTime = Math.floor(
            (initialProgress / 100) * video.duration,
          );
        }
        hasSeekedInitial = true;
      }
    } catch (e) {
      console.warn('[AVS] Lỗi khi khôi phục tiến độ:', e);
    }
  });

  video.addEventListener('timeupdate', function () {
    try {
      if (video.duration > 0 && window.reader && typeof window.reader.post === 'function') {
        var currentTime = video.currentTime;
        if (Math.abs(currentTime - lastSaveTime) >= 5) {
          lastSaveTime = currentTime;
          var progressInt = Math.floor((currentTime / video.duration) * 100);
          window.reader.post({
            type: 'save',
            data: progressInt
          });
        }
      }
    } catch (e) {
      // Bỏ qua lỗi
    }
  });
  // ----------------------------------------

  loadHlsJs(function () {
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      // Custom fragment loader: strips 127-byte PNG prefix from each segment
      // (AnimeVietsub disguises TS segments with a PNG header)
      var AvsFragLoader = function (config) {
        var loader = new Hls.DefaultConfig.loader(config);
        Object.defineProperties(this, {
          stats: { get: function () { return loader.stats; } },
          context: { get: function () { return loader.context; } },
        });
        this.abort = function () { loader.abort(); };
        this.destroy = function () { loader.destroy(); };
        this.load = function (ctx, cfg, cbs) {
          var origSuccess = cbs.onSuccess;
          var modCbs = Object.assign({}, cbs, {
            onSuccess: function (resp, stats, ctx2, net) {
              if (resp.data && resp.data.byteLength > 127) {
                resp.data = resp.data.slice(127);
              }
              origSuccess(resp, stats, ctx2, net);
            },
          });
          loader.load(ctx, cfg, modCbs);
        };
      };

      var hls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        xhrSetup: function (xhr) {
          xhr.withCredentials = false;
        },
        fLoader: AvsFragLoader,
      });
      hls.loadSource(m3u8);
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
            showError('Lỗi phát video HLS.');
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = m3u8;
    } else {
      showError('Trình duyệt không hỗ trợ phát HLS.');
      return;
    }

    inner.innerHTML = '';
    inner.appendChild(video);
  });

  function showError(msg) {
    if (inner) {
      inner.innerHTML =
        '<p style="color:#ff4444;font-family:sans-serif;text-align:center;padding:16px;">' +
        msg +
        '</p>';
    }
  }

  function loadHlsJs(callback) {
    if (typeof Hls !== 'undefined') {
      callback();
      return;
    }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js';
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
