/* eslint-disable @typescript-eslint/no-this-alias */
type Source = {
  label: string;
  src: string;
  /** real m3u8 playlist resolved by plugin */
  resolved?: string;
};

const SITE = 'https://yanhh3d.plus';
const M3U8_RE = /\.m3u8(\?|$)/i;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TS_PACKET = 188;
const TS_SYNC = 0x47;
const TS_SYNC_CHAIN = 8;
const MAX_PREFIX = 4096;

function rankQuality(btn: Source): number {
  const label = (btn.label || '').toLowerCase();
  let score = 0;
  if (btn.resolved || M3U8_RE.test(btn.src)) score += 1000;
  if (/^4k/.test(label)) score += 400;
  else if (/^1080\+/.test(label)) score += 350;
  else if (/^1080/.test(label)) score += 300;
  else if (/^hd|^720/.test(label)) score += 200;
  else if (/hyd|abyss|link10/.test(label)) score += 10;
  return score;
}

function bandwidthOf(label: string): number {
  const s = (label || '').toLowerCase();
  if (/^4k/.test(s)) return 12000000;
  if (/^1080\+/.test(s)) return 6000000;
  if (/^1080/.test(s)) return 4500000;
  if (/^hd|^720/.test(s)) return 2500000;
  return 1500000;
}

function resolutionOf(label: string): string {
  const s = (label || '').toLowerCase();
  if (/^4k/.test(s)) return '3840x2160';
  if (/^1080/.test(s)) return '1920x1080';
  return '1280x720';
}

function isPng(buf: Uint8Array): boolean {
  if (buf.length < 8) return false;
  for (let i = 0; i < 8; i++) if (buf[i] !== PNG_SIG[i]) return false;
  return true;
}

/** Strip PNG wrapper, return slice at first MPEG-TS sync byte. */
function stripPngWrapper(ab: ArrayBuffer): ArrayBuffer {
  try {
    const u8 = new Uint8Array(ab);
    if (!isPng(u8)) return ab;
    if (u8.length < TS_PACKET * TS_SYNC_CHAIN) return ab;
    const max = Math.min(u8.length, MAX_PREFIX);
    for (let i = 0; i <= max; i++) {
      if (u8[i] !== TS_SYNC) continue;
      let ok = true;
      for (let k = 1; k < TS_SYNC_CHAIN; k++) {
        const idx = i + k * TS_PACKET;
        if (idx >= u8.length || u8[idx] !== TS_SYNC) {
          ok = false;
          break;
        }
      }
      if (ok) return u8.slice(i).buffer;
    }
    return ab;
  } catch {
    return ab;
  }
}

void (async () => {
  const reader = window.nekori;
  if (!reader) throw new Error('Reader is unavailable');
  await reader.ready;
  const player = reader.player;
  if (!player) throw new Error('This chapter has no player');

  const container = document.getElementById('yanhh3d-player');
  if (!container) throw new Error('YanHH3D container missing');

  const raw = container.getAttribute('data-sources') || '[]';
  const pageUrl = container.getAttribute('data-page-url') || '';
  const debugEnabled = container.getAttribute('data-debug') === '1';
  // Derive origin from the actual chapter page — works even if SITE moves
  const site = pageUrl ? new URL(pageUrl).origin : SITE;

  if (debugEnabled) player.setDebug?.(true);

  const debugLog = (msg: string) => {
    try {
      player.log('[YanHH3D] ' + msg);
    } catch {
      //
    }
  };

  let sources: Source[] = [];
  try {
    sources = JSON.parse(raw);
  } catch (e) {
    debugLog('sources parse fail ' + String(e));
    sources = [];
  }
  debugLog('sources=' + sources.length + ' raw=' + raw.slice(0, 200));

  // variants = only sources with resolved playlist, sorted high→low
  const variants = sources
    .filter(s => s.resolved)
    .sort((a, b) => rankQuality(b) - rankQuality(a));
  const iframeSources = sources.filter(s => !s.resolved);
  debugLog(
    'variants=' +
      variants.length +
      ' labels=' +
      variants.map(v => v.label).join(','),
  );

  function buildMaster(): string {
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
    for (const v of variants) {
      const label = (v.label || 'Source').replace(/"/g, '');
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidthOf(v.label)},` +
          `AVERAGE-BANDWIDTH=${Math.floor(bandwidthOf(v.label) * 0.8)},` +
          `RESOLUTION=${resolutionOf(v.label)},NAME="${label}"`,
        v.resolved as string,
      );
    }
    return lines.join('\n') + '\n';
  }

  function isPlaylistRequest(url: string, context: unknown): boolean {
    const u = String(url || '');
    if (u.indexOf('data:') === 0 || u.indexOf('blob:') === 0) return true;
    if (u.indexOf('yanhh3d-master') !== -1) return true;
    if (M3U8_RE.test(u)) return true;
    const ctx = context as { responseType?: string; type?: string } | undefined;
    if (!ctx) return false;
    // hls.js: playlists have responseType 'text' + type MANIFEST/LEVEL/
    // AUDIO_TRACK/SUBTITLE_TRACK. Segments/keys use 'arraybuffer'/'json'.
    if (ctx.responseType === 'text') return true;
    if (ctx.responseType === 'arraybuffer' || ctx.responseType === 'json')
      return false;
    const t = String(ctx.type || '');
    return (
      t === 'manifest' ||
      t === 'level' ||
      t === 'audioTrack' ||
      t === 'subtitleTrack'
    );
  }

  async function fetchMedia(
    url: string,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    // reader.fetch proxies through host — handles CORS for cdn URLs
    const fetchFn: typeof fetch = reader.fetch.bind(reader) as typeof fetch;
    const res = await fetchFn(url, {
      signal,
      credentials: 'omit',
      headers: { Referer: pageUrl || site + '/' },
    });
    if (!res.ok)
      throw new Error('HTTP ' + res.status + ' for ' + url.slice(0, 120));
    return res.arrayBuffer();
  }

  function createLoader() {
    const masterText = buildMaster();
    const masterMarker = 'yanhh3d-master.m3u8';

    // @ts-ignore
    function YanLoader(config) {
      // @ts-ignore
      this._config = config;
      // @ts-ignore
      this.context = null;
      // @ts-ignore
      this.aborted = false;
      // @ts-ignore
      this.controller = null;
      // @ts-ignore
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
    // @ts-ignore
    YanLoader.prototype.destroy = function () {
      this.abort();
    };
    // @ts-ignore
    YanLoader.prototype.abort = function () {
      // @ts-ignore
      this.aborted = true;
      // @ts-ignore
      this.stats.aborted = true;
      if (this.controller) this.controller.abort();
      // @ts-ignore
      this.controller = null;
    };
    // @ts-ignore
    YanLoader.prototype.getResponseData = function (xhr: unknown) {
      return (xhr as { response?: unknown })?.response;
    };
    // @ts-ignore
    YanLoader.prototype.load = function (context, _config, callbacks) {
      debugLog(
        'loader ctor ok callbacks=' +
          (callbacks ? Object.keys(callbacks).join(',') : 'MISSING'),
      );
      const self = this;
      self.context = context;
      self.aborted = false;
      self.stats.aborted = false;
      self.controller = new AbortController();
      const url = (context && context.url) || '';
      const t0 = performance.now();
      self.stats.loading.start = t0;

      // Dump full context once — tells us which hls.js codepath invoked us
      const ctxType = context && context.type;
      const ctxRt = context && context.responseType;
      const ctxFrag = context && context.frag;
      debugLog(
        'load() type=' +
          String(ctxType) +
          ' rt=' +
          String(ctxRt) +
          ' frag=' +
          (ctxFrag ? 'sn=' + ctxFrag.sn + ' cc=' + ctxFrag.cc : 'none') +
          ' part=' +
          (context && context.part ? 'yes' : 'no') +
          ' url=' +
          String(url).slice(0, 110),
      );

      // Master playlist synthesized locally — return immediately
      if (url.indexOf(masterMarker) !== -1) {
        debugLog(
          'master playlist served len=' +
            masterText.length +
            ' head=' +
            masterText.slice(0, 60).replace(/\n/g, '|'),
        );
        self.stats.loading.first = performance.now();
        self.stats.loading.end = performance.now();
        self.stats.chunkCount = 1;
        self.stats.loaded = masterText.length;
        self.stats.total = masterText.length;
        callbacks.onSuccess(
          { data: masterText, url: url },
          self.stats,
          context,
          null,
        );
        return;
      }

      const playlist = isPlaylistRequest(url, context);
      debugLog('resolved as ' + (playlist ? 'PLAYLIST' : 'FRAGMENT/BINARY'));
      fetchMedia(url, self.controller.signal)
        .then(buf => {
          if (self.aborted) {
            debugLog('fetch done but aborted url=' + String(url).slice(0, 60));
            return;
          }
          self.controller = null;
          self.stats.loading.first = performance.now();
          self.stats.loading.end = performance.now();
          self.stats.chunkCount = 1;

          if (playlist) {
            const text = new TextDecoder().decode(buf);
            debugLog(
              'playlist bytes=' +
                text.length +
                ' head=' +
                text.slice(0, 40).replace(/\n/g, '|'),
            );
            self.stats.loaded = text.length;
            self.stats.total = text.length;
            callbacks.onSuccess(
              { data: text, url: url },
              self.stats,
              context,
              null,
            );
            return;
          }

          // Segment — strip PNG wrapper if present
          const ranged =
            typeof context.rangeStart === 'number' ||
            typeof context.rangeEnd === 'number';
          const clean = ranged
            ? buf.slice(
                context.rangeStart || 0,
                typeof context.rangeEnd === 'number'
                  ? context.rangeEnd
                  : buf.byteLength,
              )
            : stripPngWrapper(buf);
          const u8 = new Uint8Array(clean);
          const head = Array.from(u8.slice(0, 4))
            .map(b => b.toString(16).padStart(2, '0'))
            .join(' ');
          debugLog(
            'frag ' +
              buf.byteLength +
              '→' +
              clean.byteLength +
              ' head=' +
              head +
              ' sync=' +
              (u8[0] === 0x47 ? 'ok' : 'BAD'),
          );
          self.stats.loaded = clean.byteLength;
          self.stats.total = clean.byteLength;
          callbacks.onSuccess(
            { data: clean, url: url },
            self.stats,
            context,
            null,
          );
        })
        .catch(err => {
          if (self.aborted) {
            debugLog(
              'fetch aborted url=' +
                String(url).slice(0, 60) +
                ' ' +
                String(err).slice(0, 60),
            );
            return;
          }
          self.controller = null;
          debugLog(
            'load fail ' +
              String(
                err && (err as Error).message ? (err as Error).message : err,
              ).slice(0, 140) +
              ' url=' +
              String(url).slice(0, 80),
          );
          callbacks.onError(
            { code: 0, text: String(err) },
            context,
            null,
            self.stats,
          );
        });
    };
    return YanLoader;
  }

  // No variants → fallback iframe of first available source
  if (variants.length === 0) {
    const fallback = iframeSources[0];
    debugLog('no variants, iframe fallback=' + (fallback?.src || 'none'));
    if (fallback) {
      await player.playIframe(fallback.src);
      return;
    }
    reader.error('YanHH3D: no playable source');
    return;
  }

  const Loader = createLoader();
  const masterUrl =
    site + '/yanhh3d-master.m3u8?ep=' + encodeURIComponent(pageUrl || '');
  debugLog('playHls url=' + masterUrl.slice(0, 100));

  try {
    await player.playHls(masterUrl, {
      pLoader: Loader,
      fLoader: Loader,
      loader: Loader,
      // start at highest variant (index 0 after sort)
      startLevel: 0,
      capLevelToPlayerSize: false,
      autoStartLoad: true,
    });
  } catch (e) {
    reader.error('YanHH3D playback failed: ' + String(e));
  }
})().catch(err => window.nekori?.error(String(err)));
