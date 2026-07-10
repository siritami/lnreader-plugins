/* eslint-disable */
/// <reference types="webview" />

const createProxyFragLoader = (origin: string) => {
  return class ProxyFragLoader {
    private _config: any;
    private context: any = null;
    private _controller: AbortController | null = null;
    stats = {
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

    constructor(config: any) {
      this._config = config;
    }

    destroy() {
      this.abort();
    }

    abort() {
      if (this._controller) {
        this._controller.abort();
        this._controller = null;
      }
    }

    load(ctx: any, _cfg: any, cbs: any) {
      this.context = ctx;
      this.stats.loading.start = performance.now();

      window.reader
        .fetch(ctx.url, {
          method: 'GET',
          headers: { Referer: origin },
          referrer: origin,
        })
        .then(resp => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          this.stats.loading.first = performance.now();
          return resp.arrayBuffer();
        })
        .then(buf => {
          this.stats.loading.end = performance.now();
          this.stats.loaded = buf.byteLength;
          this.stats.total = buf.byteLength;
          cbs.onSuccess({ data: buf }, this.stats, ctx, null);
        })
        .catch(err => {
          if (err.name === 'AbortError') return;
          this.stats.loading.end = performance.now();
          cbs.onError({ code: 0, text: err.message }, ctx, null, this.stats);
        });
    }
  };
};

(async () => {
  const container = document.getElementById('nguonc-player-container');
  if (!container || !window.LNReaderPlayer) return;

  const origin = container.getAttribute('data-origin');
  const m3u8B64 = container.getAttribute('data-m3u8');
  if (!origin || !m3u8B64) return;

  const m3u8 = atob(m3u8B64);
  const blob = new Blob([m3u8], { type: 'application/vnd.apple.mpegurl' });
  const url = URL.createObjectURL(blob);

  window.LNReaderPlayer.playHls(url, {
    fLoader: createProxyFragLoader(origin),
  });
})();
