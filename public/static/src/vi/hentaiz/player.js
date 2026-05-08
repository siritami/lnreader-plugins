/**
 * HentaiZ - WebView Video Player (customJS)
 *
 * Runs inside the WebView/browser context after parseChapter returns HTML.
 *
 * Priority:
 *   1. data-video-id → decrypt m3u8 from sonar-cdn and play with HLS.js
 *   2. data-iframe   → embed iframe
 */
(function () {
  'use strict';

  var container = document.getElementById('htz-player-container');
  if (!container) return;

  var inner = document.getElementById('htz-player-inner');
  if (!inner) return;

  // ─── Priority 1: decrypt and play m3u8 ─────────────────────────
  var videoId = container.getAttribute('data-video-id');
  if (videoId) {
    decryptAndPlay(videoId);
    return;
  }

  // ─── Priority 2: iframe embed ──────────────────────────────────
  var iframeSrc = container.getAttribute('data-iframe');
  if (iframeSrc) {
    console.log('[HTZ] Embedding iframe:', iframeSrc.substring(0, 80));
    inner.innerHTML =
      '<iframe src="' +
      escapeAttr(iframeSrc) +
      '" style="width:100%;height:100%;border:none;" ' +
      'allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>';
    return;
  }

  showError('Thiếu thông tin tập phim.');

  // ─── Decrypt flow ──────────────────────────────────────────────
  function decryptAndPlay(id) {
    console.log('[HTZ] Decrypting video:', id);
    inner.innerHTML =
      '<p style="color:#fff;font-family:sans-serif;">Đang giải mã video...</p>';

    fetch('https://x.mimix.cc/watch/' + id)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var colonIdx = text.indexOf(':');
        if (colonIdx < 0) throw new Error('Invalid response format');
        var ivHex = text.substring(0, colonIdx);
        var ctHex = text.substring(colonIdx + 1);
        return decryptAesCtr(id, ivHex, ctHex);
      })
      .then(function (jsonStr) {
        var data = JSON.parse(jsonStr);
        console.log('[HTZ] Decrypted title:', data.title);
        playFromDecrypted(data);
      })
      .catch(function (err) {
        console.error('[HTZ] Decrypt error:', err);
        showError('Không thể giải mã video: ' + err.message);
      });
  }

  function decryptAesCtr(id, ivHex, ctHex) {
    var keyData = new TextEncoder().encode(id);
    return crypto.subtle
      .digest('SHA-256', keyData)
      .then(function (keyHash) {
        return crypto.subtle.importKey(
          'raw',
          keyHash,
          { name: 'AES-CTR' },
          false,
          ['decrypt'],
        );
      })
      .then(function (key) {
        var iv = hexToBytes(ivHex);
        var ct = hexToBytes(ctHex);
        return crypto.subtle.decrypt(
          { name: 'AES-CTR', counter: iv, length: 128 },
          key,
          ct,
        );
      })
      .then(function (decrypted) {
        return new TextDecoder().decode(decrypted);
      });
  }

  function hexToBytes(hex) {
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  // ─── Build m3u8 from decrypted data ────────────────────────────
  function playFromDecrypted(data) {
    var m3u8Data = data.defaultM3u8;
    if (
      !m3u8Data ||
      !m3u8Data.master ||
      !m3u8Data.playlists ||
      m3u8Data.playlists.length === 0
    ) {
      showError('Không tìm thấy dữ liệu m3u8.');
      return;
    }

    var segDomain =
      data.segmentDomains && data.segmentDomains.length > 0
        ? data.segmentDomains[0]
        : data.domain;

    // Parse variant folder names from master playlist
    var masterLines = m3u8Data.master.split('\n');
    var variantFolders = [];
    for (var i = 0; i < masterLines.length; i++) {
      var line = masterLines[i].trim();
      if (line && !line.startsWith('#') && line.includes('playlist.m3u8')) {
        variantFolders.push(line.replace('/playlist.m3u8', ''));
      }
    }

    // Rewrite each variant playlist with absolute segment URLs
    var variantBlobUrls = [];
    for (var v = 0; v < m3u8Data.playlists.length; v++) {
      var folder = variantFolders[v] || variantFolders[0] || '';
      var baseUrl = segDomain + '/' + data.id + '/' + folder + '/';
      var playlistContent = rewriteSegmentUrls(m3u8Data.playlists[v], baseUrl);
      var blob = new Blob([playlistContent], {
        type: 'application/vnd.apple.mpegurl',
      });
      variantBlobUrls.push(URL.createObjectURL(blob));
    }

    // Rewrite master playlist: replace relative variant paths with blob URLs
    var rewrittenMaster = '';
    var variantIdx = 0;
    for (var m = 0; m < masterLines.length; m++) {
      var mline = masterLines[m].trim();
      if (mline && !mline.startsWith('#') && mline.includes('playlist.m3u8')) {
        rewrittenMaster += variantBlobUrls[variantIdx] + '\n';
        variantIdx++;
      } else {
        rewrittenMaster += mline + '\n';
      }
    }

    var masterBlob = new Blob([rewrittenMaster], {
      type: 'application/vnd.apple.mpegurl',
    });
    var masterUrl = URL.createObjectURL(masterBlob);

    console.log(
      '[HTZ] Master m3u8 ready, variants:',
      variantBlobUrls.length,
    );
    buildVideoPlayer(inner, masterUrl);
  }

  function rewriteSegmentUrls(playlist, baseUrl) {
    var lines = playlist.split('\n');
    var result = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line && !line.startsWith('#') && line.length > 0) {
        result.push(baseUrl + line);
      } else {
        result.push(line);
      }
    }
    return result.join('\n');
  }

  // ─── Utilities ─────────────────────────────────────────────────
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

  // ─── Video player builder ─────────────────────────────────────
  function buildVideoPlayer(target, m3u8Url) {
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
        if (
          !hasSeekedInitial &&
          video.duration > 0 &&
          window.reader &&
          window.reader.chapter
        ) {
          var initialProgress = window.reader.chapter.progress || 0;
          if (initialProgress > 0 && initialProgress < 100) {
            video.currentTime = Math.floor(
              (initialProgress / 100) * video.duration,
            );
          }
          hasSeekedInitial = true;
        }
      } catch (e) {
        console.warn('[HTZ] Lỗi khi khôi phục tiến độ:', e);
      }
    });

    video.addEventListener('timeupdate', function () {
      try {
        if (
          video.duration > 0 &&
          window.reader &&
          typeof window.reader.post === 'function'
        ) {
          var currentTime = video.currentTime;
          if (Math.abs(currentTime - lastSaveTime) >= 5) {
            lastSaveTime = currentTime;
            var progressInt = Math.floor(
              (currentTime / video.duration) * 100,
            );
            window.reader.post({
              type: 'save',
              data: progressInt,
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
        var hls = new Hls({
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          xhrSetup: function (xhr) {
            xhr.withCredentials = false;
          },
        });
        hls.loadSource(m3u8Url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
          console.log(
            '[HTZ] HLS manifest parsed, levels:',
            hls.levels.length,
          );
          video.play().catch(function () {});
        });
        hls.on(Hls.Events.ERROR, function (event, data) {
          console.error('[HTZ HLS] error:', data.type, data.details);
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              console.log('[HTZ HLS] network error, retrying…');
              hls.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              console.log('[HTZ HLS] media error, recovering…');
              hls.recoverMediaError();
            } else {
              hls.destroy();
              showError('Lỗi phát video HLS.');
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = m3u8Url;
        video.addEventListener('loadedmetadata', function () {
          video.play().catch(function () {});
        });
      } else {
        showError('Trình duyệt không hỗ trợ phát HLS.');
        return;
      }

      target.innerHTML = '';
      target.appendChild(video);
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
      console.log('[HTZ] HLS.js loaded');
      callback();
    };
    script.onerror = function () {
      console.error('[HTZ] Failed to load HLS.js');
      showError('Không thể tải thư viện HLS.js.');
    };
    document.head.appendChild(script);
  }
})();
