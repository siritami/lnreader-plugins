/* eslint-disable */

/**
 * AnimeVietsub - WebView Video Player (index.ts)
 * This version uses the official "avs-loader.min.js" API to dynamically adapt to encryption changes.
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

  var mode = container.getAttribute('data-mode') || 'm3u8'; // 'm3u8' or 'embed'
  var debugEnabled = container.getAttribute('data-debug') === '1';
  var modeLabel = document.getElementById('avs-mode-label');
  var _debugLog = [];

  // ─── Override window.fetch to bypass CORS ──────
  var originalFetch = window.fetch;
  window.fetch =
    typeof window.reader?.fetch === 'function'
      ? window.reader.fetch
      : originalFetch;

  // ─── Priority 1: direct m3u8 URL ──
  var m3u8 = container.getAttribute('data-m3u8');
  if (m3u8) {
    console.log('[AVS] Playing m3u8 directly:', m3u8.substring(0, 80) + '…');
    buildVideoPlayer(inner, [{ file: m3u8, type: 'hls' }]);
    return;
  }

  // ─── Priority 2: pre-parsed sources array ──
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

  // ─── Priority 3: iframe embed ──
  var iframeSrc = container.getAttribute('data-iframe');
  if (iframeSrc) {
    if (iframeSrc.indexOf('googleapiscdn.com') !== -1 && mode === 'm3u8') {
      console.log(
        '[AVS] googleapiscdn + m3u8 mode, decrypting via dynamic loader…',
      );
      tryGoogleApisCdn(iframeSrc, inner);
      return;
    }
    console.log('[AVS] Embedding iframe:', iframeSrc.substring(0, 80));
    inner.innerHTML =
      '<iframe src="' +
      escapeAttr(iframeSrc) +
      '" style="width:100%;height:100%;border:none;" allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>';
    if (modeLabel) modeLabel.textContent = 'Embed mode';
    return;
  }

  // ─── Priority 4: AJAX fallback with data-hash ──
  var hash = container.getAttribute('data-hash');
  var id = container.getAttribute('data-id');
  var referer = container.getAttribute('data-referer');
  var site = container.getAttribute('data-site');

  if (!hash || !site) {
    showError('Missing episode information.');
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
        'Referer': referer || site + '/',
      },
      body: postBody,
    })
      .then(function (res) {
        return res.text();
      })
      .then(function (text) {
        var json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          showError('Cannot parse server response.');
          return;
        }
        if (!json || !json.success) {
          showError('Server returned error.');
          return;
        }
        handlePlayerResponse(json);
      })
      .catch(function (err) {
        showError('Cannot connect to server.');
      });
  }

  function handlePlayerResponse(json) {
    if (json.playTech === 'iframe' && typeof json.link === 'string') {
      if (json.link.indexOf('googleapiscdn.com') !== -1 && mode === 'm3u8') {
        tryGoogleApisCdn(json.link, inner);
        return;
      }
      inner.innerHTML =
        '<iframe src="' +
        escapeAttr(json.link) +
        '" style="width:100%;height:100%;border:none;" allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>';
      if (modeLabel) modeLabel.textContent = 'Embed mode';
      return;
    }
    if (Array.isArray(json.link)) {
      buildVideoPlayer(inner, json.link);
      return;
    }
    if (typeof json.link === 'string') {
      var link = json.link.replace(/^&http/, 'http');
      if (/\.m3u8(\?|$)/i.test(link))
        buildVideoPlayer(inner, [{ file: link, type: 'hls' }]);
      else if (/\.(mp4|webm)(\?|$)/i.test(link))
        buildVideoPlayer(inner, [{ file: link }]);
      else {
        inner.innerHTML =
          '<iframe src="' +
          escapeAttr(link) +
          '" style="width:100%;height:100%;border:none;" allowfullscreen></iframe>';
        if (modeLabel) modeLabel.textContent = 'Embed mode';
      }
    }
  }

  // ─── DYNAMIC LOADER METHOD: Inject avs-loader.min.js API ───
  function tryGoogleApisCdn(playerUrl, target) {
    // Create hidden iframe to solve Cloudflare challenge
    var iframe = document.createElement('iframe');
    iframe.style.cssText =
      'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
    iframe.src = playerUrl;
    (document.body || document.documentElement).appendChild(iframe);

    var cfWait = 1000;
    debugLog('Waiting CF ' + cfWait + 'ms…');
    setTimeout(function () {
      debugLog('CF done, fetching page…');
      fetchPlayerPageAndRunLoader(playerUrl, target, iframe);
    }, cfWait);
  }

  function fetchPlayerPageAndRunLoader(playerUrl, target, iframe) {
    fetch(playerUrl, { headers: { Referer: playerUrl } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (html) {
        cleanupIframe(iframe);

        var tokenMatch = html.match(/const\s+avsToken\s*=\s*"([^"]+)"/);
        var hashMatch = playerUrl.match(/\/player\/([0-9a-f]+)/);

        if (!tokenMatch || !hashMatch) {
          showError('Video token/hash not found.');
          return;
        }

        var avsToken = tokenMatch[1];
        var videoHash = hashMatch[1];
        var baseUrl = playerUrl.match(/^(https?:\/\/[^/]+)/)[1];

        // Default to fetch avs-loader.min.js (init.min.js contains ads, we only need the loader)
        var loaderUrlMatch = html.match(
          /<script[^>]+src="([^"]*avs-loader\.min\.js[^"]*)"/,
        );
        var loaderUrl = loaderUrlMatch
          ? loaderUrlMatch[1]
          : 'https://storage.googleapiscdn.com/static/avs-loader.min.js?v=1.3.7';
        if (loaderUrl.startsWith('/')) loaderUrl = baseUrl + loaderUrl;

        debugLog('Fetching official loader: ' + loaderUrl);

        return fetch(loaderUrl, { headers: { Referer: playerUrl } })
          .then(function (r) {
            return r.text();
          })
          .then(function (scriptText) {
            // Inject official decryption script into WebView
            try {
              var s = document.createElement('script');
              s.textContent = scriptText;
              document.body.appendChild(s);
            } catch (e) {
              showError('Failed to inject Loader Script: ' + e.message);
              return;
            }

            if (typeof window.AvsDecryptPlaylist !== 'function') {
              showError(
                'AvsDecryptPlaylist interface is not available in this script!',
              );
              return;
            }

            var m3u8Url =
              baseUrl +
              '/playlist/' +
              videoHash +
              '/playlist.m3u8?token=' +
              encodeURIComponent(avsToken);
            debugLog('Calling window.AvsDecryptPlaylist...');

            // Call the official decryption function provided by AnimeVietsub
            return window
              .AvsDecryptPlaylist(m3u8Url)
              .then(function (decryptedM3u8) {
                if (decryptedM3u8 && decryptedM3u8.indexOf('#EXTM3U') !== -1) {
                  debugLog('Dynamic Decrypt OK!');
                  var blob = new Blob([decryptedM3u8], {
                    type: 'application/vnd.apple.mpegurl',
                  });
                  var blobUrl = URL.createObjectURL(blob);
                  if (modeLabel)
                    modeLabel.textContent = 'm3u8 mode (inject_js)';
                  buildVideoPlayer(target, [{ file: blobUrl, type: 'hls' }]);
                } else {
                  showError('Decrypted result is invalid.');
                }
              });
          });
      })
      .catch(function (err) {
        cleanupIframe(iframe);
        showError('Dynamic Loader error: ' + (err.message || err));
      });
  }

  function cleanupIframe(iframe) {
    try {
      iframe.src = 'about:blank';
    } catch (e) {}
    setTimeout(function () {
      try {
        iframe.remove();
      } catch (e) {}
    }, 200);
  }

  // ─── Utilities ──────────────────────────────────────────────────
  function debugLog(msg) {
    _debugLog.push(msg);
    console.log('[AVS] ' + msg);
    if (!debugEnabled) return;
    var el = document.getElementById('avs-debug-log');
    if (!el) {
      el = document.createElement('div');
      el.id = 'avs-debug-log';
      el.style.cssText =
        'color:#aaa;font-family:monospace;font-size:11px;padding:8px;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow-y:auto;';
      container.appendChild(el);
    }
    el.textContent = _debugLog.join('\n');
  }
  function showError(msg) {
    debugLog('ERROR: ' + msg);
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
      showError('Video source not found.');
      return;
    }

    var video = document.createElement('video');
    video.controls = true;
    video.setAttribute('playsinline', '');
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.background = '#000';

    // --- Sync progress with app ---
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
        console.warn('[AVS] Error restoring progress:', e);
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
          // Update progress every 5 seconds
          if (Math.abs(currentTime - lastSaveTime) >= 5) {
            lastSaveTime = currentTime;
            var progressInt = Math.floor((currentTime / video.duration) * 100);
            window.reader.post({
              type: 'save',
              data: progressInt,
            });
          }
        }
      } catch (e) {
        // Ignore errors
      }
    });

    video.addEventListener('ended', function () {
      try {
        if (window.reader && typeof window.reader.post === 'function') {
          // mark as completed
          window.reader.post({
            type: 'save',
            data: 100,
          });
          // move to next chapter
          if (window.reader.nextChapter) window.reader.post({ type: 'next' });
        }
      } catch (e) {
        // Ignore errors
      }
    });

    // ----------------------------------------

    if (hlsSources.length > 0) {
      loadHlsJs(function () {
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
          // Custom fragment loader: uses reader.fetch proxy to bypass CORS
          // and strips 127-byte PNG prefix from each segment
          var ProxyFragLoader = function (config) {
            this._config = config;
            this.stats = {
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
            this.context = null;
            this._controller = null;
          };
          ProxyFragLoader.prototype.destroy = function () {
            this.abort();
          };
          ProxyFragLoader.prototype.abort = function () {
            if (this._controller) {
              this._controller.abort();
              this._controller = null;
            }
          };
          ProxyFragLoader.prototype.load = function (ctx, cfg, cbs) {
            this.context = ctx;
            var self = this;
            self.stats.loading.start = performance.now();
            fetch(ctx.url)
              .then(function (resp) {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                self.stats.loading.first = performance.now();
                return resp.arrayBuffer();
              })
              .then(function (buf) {
                self.stats.loading.end = performance.now();
                self.stats.loaded = buf.byteLength;
                self.stats.total = buf.byteLength;
                // Strip 127-byte PNG prefix (segments disguised as PNG)
                var data = buf;
                if (buf.byteLength > 127) {
                  var hdr = new Uint8Array(buf, 0, 8);
                  if (
                    hdr[0] === 0x89 &&
                    hdr[1] === 0x50 &&
                    hdr[2] === 0x4e &&
                    hdr[3] === 0x47 &&
                    hdr[4] === 0x0d &&
                    hdr[5] === 0x0a &&
                    hdr[6] === 0x1a &&
                    hdr[7] === 0x0a
                  ) {
                    data = buf.slice(127);
                  }
                }
                cbs.onSuccess({ data: data }, self.stats, ctx, null);
              })
              .catch(function (err) {
                debugLog('fLoader ERR: ' + err.message);
                if (err.name === 'AbortError') return;
                self.stats.loading.end = performance.now();
                cbs.onError(
                  { code: 0, text: err.message },
                  ctx,
                  null,
                  self.stats,
                );
              });
          };

          var hlsCfg = {
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            fLoader: ProxyFragLoader,
          };
          var hls = new Hls(hlsCfg);
          hls.loadSource(hlsSources[0].file);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, function () {
            video.play().catch(function () {});
          });
          hls.on(Hls.Events.ERROR, function (event, data) {
            debugLog('HLS err: ' + data.type + ' ' + data.details);
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
                  showError('HLS playback error.');
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
          showError('Browser does not support HLS playback.');
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
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js';
    script.onload = function () {
      console.log('[AVS] HLS.js loaded');
      callback();
    };
    script.onerror = function () {
      console.error('[AVS] Failed to load HLS.js');
      showError('Failed to load video player engine.');
    };
    document.head.appendChild(script);
  }
})();
