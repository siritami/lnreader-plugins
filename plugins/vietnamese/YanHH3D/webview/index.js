// YanHH3D Player Master Playlist Bootstrap with CORS Loader for Video.js

(function () {
  var started = false;

  function createProxyLoader() {
    function ProxyHlsLoader(config) {
      this._config = config;
      this.context = null;
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
    }

    ProxyHlsLoader.prototype.destroy = function () {
      this.abort();
    };

    ProxyHlsLoader.prototype.abort = function () {
      this.stats.aborted = true;
    };

    ProxyHlsLoader.prototype.getResponseData = function (xhr) {
      return xhr && xhr.response;
    };

    ProxyHlsLoader.prototype.load = function (context, _cfg, callbacks) {
      this.context = context;
      this.stats.loading.start = performance.now();
      var isLocal = /^(blob:|data:|filesystem:)/i.test(context.url);
      var fetchFn =
        !isLocal && window.reader && typeof window.reader.fetch === 'function'
          ? window.reader.fetch.bind(window.reader)
          : window.fetch.bind(window);

      fetchFn(context.url, {
        method: 'GET',
        headers: isLocal
          ? undefined
          : {
              Referer: 'https://yanhh3d.ee/',
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
      })
        .then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          this.stats.loading.first = performance.now();
          if (
            context.responseType === 'text' ||
            (context.type && context.type !== 'fragment')
          ) {
            return resp.text();
          }
          return resp.arrayBuffer();
        }.bind(this))
        .then(function (data) {
          this.stats.loading.end = performance.now();
          var len = typeof data === 'string' ? data.length : data.byteLength;
          this.stats.loaded = len;
          this.stats.total = len;
          callbacks.onSuccess(
            { data: data, url: context.url },
            this.stats,
            context,
            null,
          );
        }.bind(this))
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          this.stats.loading.end = performance.now();
          callbacks.onError(
            { code: 0, text: (err && err.message) || 'Load failed' },
            context,
            null,
            this.stats,
          );
        }.bind(this));
    };

    return ProxyHlsLoader;
  }

  function initPlayerWithBlob() {
    if (started) return;
    var dataEl = document.getElementById('yan-master-data');
    if (!dataEl) return;

    var rawBase64 = dataEl.getAttribute('data-master');
    if (!rawBase64) return;

    var player = window.LNReaderPlayer;
    if (!player) return;

    started = true;
    try {
      var decodedText = atob(rawBase64);
      var blob = new Blob([decodedText], {
        type: 'application/vnd.apple.mpegurl',
      });
      var blobUrl = URL.createObjectURL(blob);
      player.log('[YanHH3D] Playing master playlist via blob URL: ' + blobUrl);

      var loaderClass = createProxyLoader();
      player.playHls(blobUrl, {
        pLoader: loaderClass,
        fLoader: loaderClass,
      });
    } catch (err) {
      player.log('[YanHH3D] Failed to create blob for master playlist: ' + err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlayerWithBlob);
  } else {
    initPlayerWithBlob();
  }

  // Backup trigger if player takes time to mount
  var timer = setInterval(function () {
    if (started) {
      clearInterval(timer);
      return;
    }
    initPlayerWithBlob();
  }, 200);

  setTimeout(function () {
    clearInterval(timer);
  }, 10000);
})();

