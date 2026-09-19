/* eslint-disable */

/**
 * AnimeVietsub - WebView Video Player (customJS)
 *
 * Runs inside the WebView/browser context after parseChapter returns HTML.
 *
 * Priority:
 *   1. data-m3u8   → HLS + PNG-strip loader (CloudStream algorithm)
 *   2. data-sources → direct source playback
 *   3. data-iframe  → embed iframe
 *   4. data-hash    → AJAX /ajax/player fallback
 */
import { initUtils, debugLog, showError } from './utils';
import { fetchAjaxPlayer } from './ajax';
import {
  resolveGoogleApisCdn,
  ShieldDecryptUnsupportedError,
} from './google_cdn';
import type { PlayerConfig, ResolvedMedia } from './types';

/** CloudStream AnimeVietsubProvider: PNG shell + MPEG-TS sync strip. */
const AVS_TS_SYNC = 0x47;
const AVS_TS_PACKET = 188;
const AVS_TS_SYNC_CHAIN = 8;
const AVS_MAX_PREFIX = 4096;

function stripAvsPngPrefix(ab: ArrayBuffer): ArrayBuffer {
  try {
    const u8 = new Uint8Array(ab);
    if (u8.length < 4) return ab;
    if (u8[0] !== 0x89 || u8[1] !== 0x50 || u8[2] !== 0x4e || u8[3] !== 0x47) {
      return ab;
    }
    const max = Math.min(u8.length, AVS_MAX_PREFIX);
    for (let i = 0; i <= max; i++) {
      if (u8[i] !== AVS_TS_SYNC) continue;
      let ok = true;
      for (let k = 1; k < AVS_TS_SYNC_CHAIN; k++) {
        const idx = i + k * AVS_TS_PACKET;
        if (idx >= u8.length || u8[idx] !== AVS_TS_SYNC) {
          ok = false;
          break;
        }
      }
      if (ok) {
        debugLog('[AVS] strip PNG prefix=' + i + ' / ' + u8.length);
        return u8.slice(i).buffer;
      }
    }
    return ab;
  } catch {
    return ab;
  }
}

function nativeFetchAny(url: string): Promise<{ status: number; text: string; buffer: ArrayBuffer }> {
  // blob:/data: must use page fetch — reader.fetch proxy returns empty/garbage.
  const isBlob = /^blob:|^data:/i.test(url);
  const fetchFn = isBlob
    ? fetch.bind(window)
    : // @ts-ignore
      window.reader && window.reader.fetch
      ? // @ts-ignore
        window.reader.fetch.bind(window.reader)
      : fetch;
  return fetchFn(url, {
    credentials: 'include',
    headers: isBlob
      ? undefined
      : {
          Referer: 'https://stream.googleapiscdn.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        },
  }).then(async (r: Response) => {
    const buffer = await r.arrayBuffer();
    let text = '';
    try {
      text = new TextDecoder().decode(buffer);
    } catch {
      text = '';
    }
    return { status: r.status, text, buffer };
  });
}

function isPlaylistLike(url: string, context: any): boolean {
  const u = String(url || '');
  const t = String((context && context.type) || (context && context.responseType) || '');
  return (
    u.indexOf('blob:') === 0 ||
    u.indexOf('data:') === 0 ||
    /\.m3u8(\?|$)/i.test(u) ||
    /playlist\.m3u8/i.test(u) ||
    t === 'manifest' ||
    t === 'level' ||
    t === 'text'
  );
}

/** Fresh hls.js stats — never write onto this.stats (hls may wipe it). */
function makeLoaderStats(t0: number, loaded: number) {
  return {
    aborted: false,
    loaded,
    total: loaded,
    retry: 0,
    chunkCount: 1,
    loading: { start: t0, first: t0, end: Date.now() },
  };
}

/**
 * hls.js loader: reader.fetch + PNG-strip (CloudStream).
 * Playlist/blob → text; media segments → PNG-stripped ArrayBuffer.
 */
function createAvsTsLoader() {
  // @ts-ignore
  function AvsTsLoader(config) {
    // @ts-ignore
    this.config = config;
    // @ts-ignore
    this.aborted = false;
  }
  // @ts-ignore
  AvsTsLoader.prototype.load = function (context, _config, callbacks) {
    const self = this;
    const url = (context && context.url) || '';
    const t0 = Date.now();
    const asPlaylist = isPlaylistLike(url, context);
    debugLog(
      '[AVS] GET ' +
        (asPlaylist ? 'playlist' : 'segment') +
        ' ' +
        String(url).slice(0, 90),
    );

    nativeFetchAny(url)
      .then(res => {
        if (self.aborted) return;

        if (asPlaylist) {
          let body = res.text;
          if (!body || body.indexOf('#EXTM3U') === -1) {
            try {
              body = new TextDecoder().decode(res.buffer);
            } catch {
              body = body || '';
            }
          }
          debugLog(
            '[AVS] playlist body len=' +
              body.length +
              ' head=' +
              body.slice(0, 60).replace(/\n/g, '|'),
          );
          if (body.length < 40) {
            debugLog('[AVS] playlist too short — decrypt output may be empty');
          }
          callbacks.onSuccess(
            makeLoaderStats(t0, body.length),
            body,
            { status: res.status, url, responseURL: url },
            context,
          );
          return;
        }

        const clean = stripAvsPngPrefix(res.buffer);
        debugLog(
          '[AVS] segment bytes=' +
            res.buffer.byteLength +
            ' clean=' +
            clean.byteLength,
        );
        callbacks.onSuccess(
          makeLoaderStats(t0, clean.byteLength),
          clean,
          { status: res.status, url, responseURL: url },
          context,
        );
      })
      .catch((err: any) => {
        if (self.aborted) return;
        debugLog('[AVS] GET fail ' + String(err && err.message).slice(0, 80));
        callbacks.onError(
          { code: 0, text: String(err && err.message) },
          context,
          { status: 0, url },
          makeLoaderStats(Date.now(), 0),
        );
      });
  };
  // @ts-ignore
  AvsTsLoader.prototype.abort = function () {
    // @ts-ignore
    this.aborted = true;
  };
  // @ts-ignore
  AvsTsLoader.prototype.destroy = function () {
    // noop
  };
  return AvsTsLoader;
}

function iframeFallback(config: PlayerConfig): ResolvedMedia | null {
  if (config.iframeSrc) {
    debugLog('Fallback: nhúng iframe player.');
    return { type: 'iframe', iframeUrl: config.iframeSrc };
  }
  return null;
}

function parseConfig(container: HTMLElement): PlayerConfig {
  return {
    mode: container.getAttribute('data-mode') || 'm3u8',
    playerType: container.getAttribute('data-player-type') || 'artplayer',
    debugEnabled: container.getAttribute('data-debug') === '1',
    m3u8: container.getAttribute('data-m3u8'),
    sourcesRaw: container.getAttribute('data-sources'),
    iframeSrc: container.getAttribute('data-iframe'),
    ajaxHash: container.getAttribute('data-hash'),
    ajaxId: container.getAttribute('data-id'),
    ajaxReferer: container.getAttribute('data-referer'),
    ajaxSite: container.getAttribute('data-site'),
    bannerUrl: container.getAttribute('data-banner'),
  };
}

async function resolveMedia(config: PlayerConfig): Promise<ResolvedMedia> {
  // 1. Direct M3u8
  if (config.m3u8) {
    debugLog('Resolver: Dùng trực tiếp M3U8.');
    return { type: 'sources', sources: [{ file: config.m3u8, type: 'hls' }] };
  }

  // 2. Parsed Sources
  if (config.sourcesRaw) {
    try {
      const sources = JSON.parse(config.sourcesRaw);
      debugLog('Resolver: Dùng parsed sources (' + sources.length + ' items).');
      return { type: 'sources', sources: sources };
    } catch (e) {
      debugLog('Resolver Warning: Không thể parse data-sources.');
    }
  }

  // 3. Iframe Embed (or GoogleApisCdn Decryption)
  if (config.iframeSrc) {
    if (
      config.iframeSrc.indexOf('googleapiscdn.com') !== -1 &&
      config.mode === 'm3u8'
    ) {
      debugLog('Resolver: Kích hoạt GoogleApisCdn Decryptor.');
      try {
        return await resolveGoogleApisCdn(config.iframeSrc);
      } catch (e: any) {
        if (
          e instanceof ShieldDecryptUnsupportedError ||
          /AVS_SHIELD|AVS shield|Giải mã|Không tìm thấy avsToken|Thiếu thông tin|không giải mã được|không nhận dạng/i.test(
            e?.message || '',
          )
        ) {
          const fb = iframeFallback(config);
          if (fb) return fb;
        }
        throw e;
      }
    }
    debugLog('Resolver: Dùng Iframe nhúng trực tiếp.');
    return { type: 'iframe', iframeUrl: config.iframeSrc };
  }

  // 4. Ajax Fallback
  if (config.ajaxHash && config.ajaxSite) {
    debugLog('Resolver: Kích hoạt Ajax Fallback.');
    try {
      return await fetchAjaxPlayer(config);
    } catch (e: any) {
      debugLog('Ajax/m3u8 path failed: ' + (e?.message || e));
      throw e;
    }
  }

  throw new Error('Thiếu thông tin cấu hình, không thể xác định nguồn phát.');
}

function buildHlsConfig() {
  const Loader = createAvsTsLoader();
  return {
    loader: Loader,
    pLoader: Loader,
    fLoader: Loader,
    enableWorker: false,
    lowLatencyMode: false,
    xhrSetup: (xhr: any, url: string) => {
      try {
        xhr.setRequestHeader('Referer', 'https://stream.googleapiscdn.com/');
      } catch {
        //
      }
    },
  };
}

function renderMedia(resolved: ResolvedMedia, config: PlayerConfig) {
  // @ts-ignore
  if (!window.LNReaderPlayer) return;
  // @ts-ignore
  const player = window.LNReaderPlayer;

  if (resolved.type === 'sources' && resolved.sources) {
    const s = resolved.sources[0];
    const file = (s.file || '').replace(/^&http/, 'http');
    if (s.type === 'hls' || /\.m3u8(\?|$)/i.test(file) || file.indexOf('blob:') === 0) {
      debugLog('[AVS] Playing M3U8: ' + file.slice(0, 80));
      player.playHls(file, buildHlsConfig());
    } else {
      player.log('[AVS] Playing Direct: ' + file);
      player.playDirect(file);
    }
  } else if (resolved.type === 'iframe' && resolved.iframeUrl) {
    player.log('[AVS] Playing Iframe: ' + resolved.iframeUrl);
    player.playIframe(resolved.iframeUrl);
  } else {
    player.log(
      '[AVS] Error: Không nhận được định dạng phát hợp lệ từ Resolver.',
    );
  }
}

async function initPlayer() {
  const container = document.getElementById('avs-player-container');
  if (!container) return;

  const config = parseConfig(container);
  initUtils(container);

  try {
    const resolvedMedia = await resolveMedia(config);
    if (resolvedMedia.type === 'sources' && resolvedMedia.sources) {
      const file = resolvedMedia.sources[0].file || '';
      debugLog('Resolved HLS (' + file.slice(0, 32) + '…)');
    }
    renderMedia(resolvedMedia, config);
  } catch (error: any) {
    debugLog('Pipeline error: ' + (error && error.message));
    showError(error.message || 'Lỗi không xác định.');
    console.error('[AVS] Pipeline Error:', error);
    if (config.iframeSrc) {
      debugLog('Fallback: nhúng iframe sau lỗi m3u8.');
      renderMedia({ type: 'iframe', iframeUrl: config.iframeSrc }, config);
    } else if (config.ajaxHash && config.ajaxSite) {
      debugLog('Fallback: thử iframe từ ajax hash…');
      try {
        const fb = await fetchAjaxPlayer({ ...config, mode: 'embed' });
        renderMedia(fb, config);
      } catch (e2: any) {
        debugLog('Ajax embed fallback fail: ' + (e2 && e2.message));
      }
    }
  }
}

initPlayer();
