/// <reference path="./typings/global.d.ts" />
/// <reference types="webview" />

import { debugLog, showError, escapeAttr } from './utils';
import type { MediaSource } from './types';

export function renderIframe(target: HTMLElement, iframeUrl: string, modeLabel: HTMLElement | null) {
  debugLog('Embedding iframe: ' + iframeUrl.substring(0, 80));
  target.innerHTML =
    '<iframe src="' +
    escapeAttr(iframeUrl) +
    '" style="width:100%;height:100%;border:none;" ' +
    'allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>';
  if (modeLabel) modeLabel.textContent = 'Đang ở chế độ embed';
}

export async function buildVideoPlayer(target: HTMLElement, sources: MediaSource[], modeLabel: HTMLElement | null) {
  const hlsSources: MediaSource[] = [];
  const otherSources: MediaSource[] = [];

  (sources || []).forEach(function (s) {
    const file = (s.file || '').replace(/^&http/, 'http');
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

  const video = document.createElement('video');
  video.controls = true;
  video.setAttribute('playsinline', '');
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.background = '#000';

  let hasSeekedInitial = false;
  let lastSaveTime = 0;

  video.addEventListener('loadedmetadata', function () {
    try {
      if (
        !hasSeekedInitial &&
        video.duration > 0 &&
        window.reader &&
        window.reader.chapter
      ) {
        const initialProgress = window.reader.chapter.progress || 0;
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
      if (
        video.duration > 0 &&
        window.reader &&
        typeof window.reader.post === 'function'
      ) {
        const currentTime = video.currentTime;
        if (Math.abs(currentTime - lastSaveTime) >= 5) {
          lastSaveTime = currentTime;
          const progressInt = Math.floor((currentTime / video.duration) * 100);
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

  video.addEventListener('ended', function () {
    try {
      if (window.reader && typeof window.reader.post === 'function') {
        window.reader.post({
          type: 'save',
          data: 100,
        });
        if (window.reader.nextChapter) window.reader.post({ type: 'next' });
      }
    } catch (e) {
      // Bỏ qua lỗi
    }
  });

  if (hlsSources.length > 0) {
    if (modeLabel) modeLabel.textContent = 'Đang ở chế độ m3u8';
    
    try {
      await loadHlsJs();
      
      if (typeof Hls !== 'undefined' && Hls.isSupported()) {
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
          const self = this;
          self.stats.loading.start = performance.now();

          const fetchFn = (window.reader && window.reader.fetch) ? window.reader.fetch.bind(window.reader) : fetch;

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
                  hdr[0] === 0x89 && hdr[1] === 0x50 && hdr[2] === 0x4e && hdr[3] === 0x47 &&
                  hdr[4] === 0x0d && hdr[5] === 0x0a && hdr[6] === 0x1a && hdr[7] === 0x0a
                ) {
                  data = buf.slice(127);
                }
              }
              cbs.onSuccess({ data: data }, self.stats, ctx, null);
            } catch (err: any) {
              debugLog('fLoader ERR: ' + err.message);
              if (err.name === 'AbortError') return;
              self.stats.loading.end = performance.now();
              cbs.onError(
                { code: 0, text: err.message },
                ctx,
                null,
                self.stats,
              );
            }
          })();
        };

        const hlsCfg = {
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          fLoader: ProxyFragLoader,
        };
        
        const hls = new Hls(hlsCfg);
        hls.loadSource(hlsSources[0].file);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
          video.play().catch(function () { });
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
          video.play().catch(function () { });
        });
      } else if (otherSources.length > 0) {
        appendMp4Sources(video, otherSources);
      } else {
        showError('Trình duyệt không hỗ trợ phát HLS.');
        return;
      }

      target.innerHTML = '';
      target.appendChild(video);
    } catch (err) {
      showError('Không thể tải thư viện HLS.js.');
    }
  } else {
    appendMp4Sources(video, otherSources);
    target.innerHTML = '';
    target.appendChild(video);
  }
}

function appendMp4Sources(video: HTMLVideoElement, sources: MediaSource[]) {
  sources.forEach(function (s) {
    const source = document.createElement('source');
    source.src = s.file;
    source.type = 'video/' + (s.type || 'mp4');
    if (s.label) source.setAttribute('label', s.label);
    video.appendChild(source);
  });
}

function loadHlsJs(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof Hls !== 'undefined') {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js';
    script.onload = () => {
      console.log('[AVS] HLS.js loaded');
      resolve();
    };
    script.onerror = () => {
      console.error('[AVS] Failed to load HLS.js');
      reject(new Error('Failed to load HLS.js'));
    };
    document.head.appendChild(script);
  });
}
