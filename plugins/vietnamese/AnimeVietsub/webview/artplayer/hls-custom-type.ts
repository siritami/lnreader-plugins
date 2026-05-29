import Hls from '../modules/hls.min.cjs';
import { debugLog } from '../utils';

export function m3u8CustomType(video: HTMLVideoElement, url: string, art: any) {
  if (Hls.isSupported()) {
    const ProxyFragLoader = function (this: any, config: any) {
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
    } as any;

    ProxyFragLoader.prototype.destroy = function () {
      this.abort();
    };

    ProxyFragLoader.prototype.abort = function () {
      if (this._controller) {
        this._controller.abort();
        this._controller = null;
      }
    };

    ProxyFragLoader.prototype.load = function (ctx: any, cfg: any, cbs: any) {
      this.context = ctx;
      // eslint-disable-next-line
      const self = this;
      self.stats.loading.start = performance.now();

      const fetchFn =
        window.reader && window.reader.fetch
          ? window.reader.fetch.bind(window.reader)
          : fetch;

      (async () => {
        try {
          const resp = await fetchFn(ctx.url);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);

          self.stats.loading.first = performance.now();
          const buf = await resp.arrayBuffer();

          self.stats.loading.end = performance.now();
          self.stats.loaded = buf.byteLength;
          self.stats.total = buf.byteLength;

          let data = buf;
          if (buf.byteLength > 127) {
            const hdr = new Uint8Array(buf, 0, 8);
            if (
              hdr[0] === 0x89 && // P
              hdr[1] === 0x50 && // N
              hdr[2] === 0x4e && // G
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
        } catch (err: any) {
          debugLog('fLoader ERR: ' + err.message);
          if (err.name === 'AbortError') return;
          self.stats.loading.end = performance.now();
          cbs.onError({ code: 0, text: err.message }, ctx, null, self.stats);
        }
      })();
    };

    const hlsCfg = {
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      fLoader: ProxyFragLoader,
    };

    const hls = new Hls(hlsCfg);
    hls.loadSource(url);
    hls.attachMedia(video);

    art.hls = hls;

    art.on('destroy', () => {
      if (hls) {
        hls.destroy();
      }
    });

    hls.on(Hls.Events.ERROR, function (event: any, data: any) {
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
          art.notice.show = 'Lỗi phát video HLS.';
        }
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
  } else {
    art.notice.show = 'Trình duyệt không hỗ trợ định dạng HLS.';
  }
}
