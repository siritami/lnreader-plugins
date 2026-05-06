/**
 * AnimeVietsub - WebView Video Player (customJS)
 *
 * Runs inside the WebView/browser context after parseChapter returns HTML.
 * Flow:
 *   1. GET the episode page to establish session cookies
 *   2. Try extracting video URLs from inline page scripts
 *   3. POST /ajax/player with cookies (WebView context)
 *   4. If anti-adblock detected → fall back to iframe embed
 *   5. Load HLS.js for m3u8 streams
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

  // ─── Step 1: GET the episode page to establish session cookies ───
  // Also try to extract video data from inline scripts.
  console.log('[AVS] Step 1: fetching episode page for session…');
  fetch(referer, {
    credentials: 'include',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: site + '/',
    },
  })
    .then(function (res) {
      return res.text();
    })
    .then(function (pageHtml) {
      // Try to find video data embedded in inline scripts
      var inlineData = extractInlinePlayerData(pageHtml);
      if (inlineData) {
        console.log('[AVS] Found inline player data:', inlineData);
        handlePlayerResponse(inlineData);
        return;
      }
      // No inline data found → proceed to AJAX call
      return callAjaxPlayer();
    })
    .catch(function (err) {
      console.warn('[AVS] Pre-flight GET failed:', err);
      // Try AJAX anyway – maybe cookies already exist
      return callAjaxPlayer();
    });

  // ─── Step 2: POST /ajax/player ──────────────────────────────────
  function callAjaxPlayer() {
    var postBody = 'link=' + encodeURIComponent(hash);
    if (id) postBody += '&id=' + encodeURIComponent(id);

    console.log('[AVS] Step 2: calling /ajax/player…');
    return fetch(site + '/ajax/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: referer,
        Origin: site,
      },
      body: postBody,
      credentials: 'include',
    })
      .then(function (res) {
        return res.text();
      })
      .then(function (text) {
        console.log('[AVS] /ajax/player raw response:', text.slice(0, 300));

        // Check for anti-adblock / error messages
        if (isAntiAdblock(text)) {
          console.warn('[AVS] Anti-adblock detected → iframe fallback');
          showIframeFallback();
          return;
        }

        var json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          console.warn('[AVS] Non-JSON response → iframe fallback');
          showIframeFallback();
          return;
        }

        if (!json || !json.success) {
          console.warn('[AVS] API returned failure → iframe fallback');
          showIframeFallback();
          return;
        }

        handlePlayerResponse(json);
      })
      .catch(function (err) {
        console.error('[AVS] /ajax/player fetch error:', err);
        showIframeFallback();
      });
  }

  // ─── Response handler ───────────────────────────────────────────
  function handlePlayerResponse(json) {
    var inner = document.getElementById('avs-player-inner');
    if (!inner) return;

    // iframe player
    if (json.playTech === 'iframe' && typeof json.link === 'string') {
      inner.innerHTML =
        '<iframe src="' +
        escapeAttr(json.link) +
        '" style="width:100%;height:100%;border:none;" ' +
        'allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>';
      return;
    }

    // direct sources array (api / all / embed)
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
        // Unknown URL format → try iframe
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

  // ─── Inline script extractor ────────────────────────────────────
  // Tries to find video URLs embedded directly in <script> tags
  // so we don't need the AJAX call at all.
  function extractInlinePlayerData(html) {
    if (!html) return null;
    try {
      // Pattern 1: var player_aa498_config = {sources:[{file:"..."}]}
      var m = html.match(
        /player_\w+_config\s*=\s*(\{[\s\S]*?sources\s*:\s*\[[\s\S]*?\][\s\S]*?\})\s*;/,
      );
      if (m) {
        var cfg = JSON.parse(m[1].replace(/'/g, '"'));
        if (cfg.sources && cfg.sources.length)
          return { success: 1, playTech: 'api', link: cfg.sources };
      }

      // Pattern 2: "file":"https://...m3u8..." inside a script
      m = html.match(/"file"\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
      if (m)
        return {
          success: 1,
          playTech: 'api',
          link: [{ file: m[1], type: 'hls' }],
        };

      // Pattern 3: mp4 direct link
      m = html.match(/"file"\s*:\s*"(https?:\/\/[^"]+\.mp4[^"]*)"/);
      if (m) return { success: 1, playTech: 'api', link: [{ file: m[1] }] };

      // Pattern 4: iframe src in script (e.g. link: "https://...embed...")
      m = html.match(
        /(?:link|src|url)\s*[:=]\s*["'](https?:\/\/[^"']+embed[^"']*)["']/,
      );
      if (m) return { success: 1, playTech: 'iframe', link: m[1] };
    } catch (e) {
      console.warn('[AVS] extractInlinePlayerData error:', e);
    }
    return null;
  }

  // ─── Anti-adblock detection ─────────────────────────────────────
  function isAntiAdblock(text) {
    if (!text) return false;
    return (
      text.indexOf('chặn quảng cáo') !== -1 ||
      text.indexOf('chan quang cao') !== -1 ||
      text.indexOf('adblock') !== -1 ||
      text.indexOf('Vui lòng tắt') !== -1 ||
      text.indexOf('vui long tat') !== -1
    );
  }

  // ─── Iframe fallback ───────────────────────────────────────────
  function showIframeFallback() {
    var inner = document.getElementById('avs-player-inner');
    if (!inner) return;
    console.log('[AVS] Showing iframe fallback:', referer);
    inner.innerHTML =
      '<iframe src="' +
      escapeAttr(referer) +
      '" style="width:100%;height:100%;border:none;" ' +
      'sandbox="allow-scripts allow-same-origin allow-forms allow-popups" ' +
      'allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>';
  }

  // ─── Error display ─────────────────────────────────────────────
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

  // ─── Video player builder ──────────────────────────────────────
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
                // HLS failed – try mp4 fallback
                if (otherSources.length > 0) {
                  appendMp4Sources(video, otherSources);
                } else {
                  showError('Lỗi phát video HLS.');
                }
              }
            }
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari / iOS native HLS
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

        inner.innerHTML = '';
        inner.appendChild(video);
      });
    } else {
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
