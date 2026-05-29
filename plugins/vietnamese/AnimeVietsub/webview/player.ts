// eslint-disable-next-line
/// <reference path="./typings/global.d.ts" />
/// <reference types="webview" />

import { debugLog, showError, escapeAttr } from './utils';
import type { MediaSource } from './types';
import { initArtplayer } from './artplayer';

export function renderIframe(
  target: HTMLElement,
  iframeUrl: string,
  modeLabel: HTMLElement | null,
) {
  debugLog('Embedding iframe: ' + iframeUrl.substring(0, 80));
  target.innerHTML =
    '<iframe src="' +
    escapeAttr(iframeUrl) +
    '" style="width:100%;height:100%;border:none;" ' +
    'allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>';
  if (modeLabel) modeLabel.textContent = 'Đang ở chế độ embed';
}

export async function buildVideoPlayer(
  target: HTMLElement,
  sources: MediaSource[],
  modeLabel: HTMLElement | null,
  bannerUrl?: string,
) {
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

  target.innerHTML = '';
  const artContainer = document.createElement('div');
  artContainer.style.width = '100%';
  artContainer.style.height = '100%';
  target.appendChild(artContainer);

  let initialUrl = '';
  let initialType = '';

  if (hlsSources.length > 0) {
    initialUrl = hlsSources[0].file;
    initialType = 'm3u8';
    if (modeLabel) modeLabel.textContent = 'Đang ở chế độ m3u8';
  } else {
    initialUrl = otherSources[0].file;
    initialType = otherSources[0].type || 'mp4';
    if (modeLabel) modeLabel.textContent = 'Đang ở chế độ mp4';
  }

  initArtplayer(artContainer, initialUrl, initialType, bannerUrl);
}
