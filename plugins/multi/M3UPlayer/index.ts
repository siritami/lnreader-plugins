import { fetchText } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';

type KodipropInfo = {
  manifestType: string;
  licenseType: string;
  licenseKey: string;
};

type PlaylistItem = {
  name: string;
  tvg: {
    id: string;
    name: string;
    logo: string;
    url: string;
    rec: string;
    shift: string;
  };
  group: {
    title: string;
  };
  http: {
    referrer: string;
    'user-agent': string;
  };
  url: string;
  catchup: {
    type: string;
    days: string;
    source: string;
  };
  timeshift: string;
  lang: string;
  kodiprop: KodipropInfo;
};

const defaultKodiprop: KodipropInfo = {
  manifestType: '',
  licenseType: '',
  licenseKey: '',
};

const iptvPlaylistParser = {
  parse: (content: string) => {
    const getAttribute = (str: string, name: string) => {
      const regex = new RegExp(`${name}="(.*?)"`, 'gi');
      const match = regex.exec(str);
      return match?.[1] ?? '';
    };
    const getName = (str: string) => {
      const info = str.replace(/="(.*?)"/g, '');
      const parts = info.split(/,(.*)/);
      return parts[1] || '';
    };
    const getOption = (str: string, name: string) => {
      const regex = new RegExp(`:${name}=(.*)`, 'gi');
      const match = regex.exec(str);
      return typeof match?.[1] === 'string' ? match[1].replace(/"/g, '') : '';
    };
    const getValue = (str: string) => {
      const regex = new RegExp(':(.*)', 'gi');
      const match = regex.exec(str);
      return typeof match?.[1] === 'string' ? match[1].replace(/"/g, '') : '';
    };
    const getParameter = (str: string, name: string) => {
      const params = str.replace(/^(.*)\|/, '');
      const regex = new RegExp(`${name}=(\\w[^&]*)`, 'gi');
      const match = regex.exec(params);
      return match?.[1] ?? '';
    };

    const lines = content.split(/\r?\n/);
    if (!lines[0] || !/^#EXTM3U/.test(lines[0]))
      throw new Error('Playlist is not valid');

    const items: PlaylistItem[] = [];
    let currentItem: Partial<PlaylistItem> | null = null;
    let currentKodiprop: KodipropInfo = { ...defaultKodiprop };

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        currentKodiprop = { ...defaultKodiprop };
        currentItem = {
          name: getName(line),
          tvg: {
            id: getAttribute(line, 'tvg-id'),
            name: getAttribute(line, 'tvg-name'),
            logo: getAttribute(line, 'tvg-logo'),
            url: getAttribute(line, 'tvg-url'),
            rec: getAttribute(line, 'tvg-rec'),
            shift: getAttribute(line, 'tvg-shift'),
          },
          group: {
            title: getAttribute(line, 'group-title'),
          },
          http: {
            referrer: getAttribute(line, 'referrer'),
            'user-agent': getAttribute(line, 'user-agent'),
          },
          url: '',
          catchup: {
            type: getAttribute(line, 'catchup'),
            days: getAttribute(line, 'catchup-days'),
            source: getAttribute(line, 'catchup-source'),
          },
          timeshift: getAttribute(line, 'timeshift'),
          lang: getAttribute(line, 'lang'),
        };
      } else if (line.startsWith('#KODIPROP:')) {
        const prop = line.substring('#KODIPROP:'.length).trim();
        if (prop.startsWith('inputstream.adaptive.manifest_type=')) {
          currentKodiprop.manifestType = prop.split('=', 2)[1];
        } else if (prop.startsWith('inputstream.adaptive.license_type=')) {
          currentKodiprop.licenseType = prop.split('=', 2)[1];
        } else if (prop.startsWith('inputstream.adaptive.license_key=')) {
          currentKodiprop.licenseKey = prop.split('=', 2)[1];
        }
      } else if (line.startsWith('#EXTVLCOPT:')) {
        if (!currentItem?.http) continue;
        currentItem.http.referrer =
          getOption(line, 'http-referrer') || currentItem.http.referrer;
        currentItem.http['user-agent'] =
          getOption(line, 'http-user-agent') || currentItem.http['user-agent'];
      } else if (line.startsWith('#EXTGRP:')) {
        if (!currentItem?.group) continue;
        currentItem.group.title = getValue(line) || currentItem.group.title;
      } else if (line.startsWith('#')) {
        continue;
      } else {
        if (!currentItem?.http) continue;
        currentItem.url = line;
        currentItem.http['user-agent'] =
          getParameter(line, 'user-agent') || currentItem.http['user-agent'];
        currentItem.http.referrer =
          getParameter(line, 'referer') || currentItem.http.referrer;
        currentItem.kodiprop = { ...currentKodiprop };
        items.push(currentItem as PlaylistItem);
        currentItem = null;
        currentKodiprop = { ...defaultKodiprop };
      }
    }

    return { items };
  },
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function detectStreamFormat(
  url: string,
  manifestType: string,
): 'm3u8' | 'mp4' | 'webm' | 'mpd' | 'flv' | 'unknown' {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.m3u8')) return 'm3u8';
  if (u.endsWith('.mp4')) return 'mp4';
  if (u.endsWith('.webm')) return 'webm';
  if (u.endsWith('.mpd')) return 'mpd';
  if (u.endsWith('.flv')) return 'flv';
  if (manifestType === 'hls' || manifestType === 'm3u8') return 'm3u8';
  if (manifestType === 'mpd' || manifestType === 'dash') return 'mpd';
  if (url.includes('.m3u8') || url.includes('/hls/')) return 'm3u8';
  if (url.includes('.mpd') || url.includes('/dash/')) return 'mpd';
  return 'unknown';
}

class M3UPlayerPlugin implements Plugin.PluginBase {
  id = 'yuneko.m3uplayer';
  name = '🎞 M3U Player';
  icon = 'src/multi/m3uplayer/icon.png';
  site = 'https://vnepg.site';
  version = '1.3.0';
  customJS = 'src/multi/m3uplayer/player.js';

  pluginSettings: Plugin.PluginSettings = {
    m3uUrl: {
      value: '',
      label: 'M3U URL',
      type: 'Text',
    },
  };

  get m3uUrl(): string {
    const url = (storage.get('m3uUrl') || this.pluginSettings.m3uUrl.value) as string;
    if (!url) throw new Error("Please add a valid M3U playlist URL in the plugin settings.");
    return url;
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1 || !this.m3uUrl) return [];
    const text = await fetchText(this.m3uUrl);

    const playlist = iptvPlaylistParser.parse(text);

    return playlist.items.map(item => {
      const params = new URLSearchParams();
      params.set('url', item.url);
      params.set('name', item.name);
      if (item.tvg.logo) params.set('logo', item.tvg.logo);
      if (item.http['user-agent']) params.set('ua', item.http['user-agent']);
      if (item.http.referrer) params.set('referer', item.http.referrer);
      if (item.kodiprop.manifestType) params.set('mt', item.kodiprop.manifestType);
      if (item.kodiprop.licenseType) params.set('lt', item.kodiprop.licenseType);
      if (item.kodiprop.licenseKey) params.set('lk', item.kodiprop.licenseKey);

      const fmt = detectStreamFormat(item.url, item.kodiprop.manifestType);
      const tag =
        fmt === 'm3u8' ? '🟢HLS'
        : fmt === 'mp4' || fmt === 'webm' ? '🔵MP4'
        : fmt === 'mpd' && item.kodiprop.licenseType === 'widevine' ? '🔴DRM'
        : fmt === 'mpd' && item.kodiprop.licenseType === 'clearkey' ? '🟡DRM'
        : fmt === 'mpd' ? '🟠DASH'
        : fmt === 'flv' ? '⚪FLV'
        : '';

      return {
        name: tag ? `${item.name} ${tag}` : item.name,
        path: `/m3u?${params.toString()}`,
        cover: item.tvg.logo || defaultCover,
      };
    });
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];
    const novels = await this.popularNovels(1);
    return novels.filter(n =>
      n.name.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    if (!novelPath.startsWith('/m3u?')) {
      throw new Error("Invalid URL");
    }
    const params = new URLSearchParams(novelPath.split('?')[1]);
    const name = params.get('name') || 'Unknown';
    const cover = params.get('logo') || defaultCover;
    const url = params.get('url') || '';
    const mt = params.get('mt') || '';
    const lt = params.get('lt') || '';

    const fmt = detectStreamFormat(url, mt);
    const fmtLabel = fmt.toUpperCase();
    const drmLabel = lt ? ` [${lt.toUpperCase()}]` : '';

    return {
      path: novelPath,
      name,
      cover,
      status: NovelStatus.Ongoing,
      chapters: [
        {
          name: `${name} (${fmtLabel}${drmLabel})`,
          path: novelPath,
          chapterNumber: 1,
        },
      ],
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    if (!chapterPath.startsWith('/m3u?')) {
      throw new Error("Invalid URL");
    }
    const params = new URLSearchParams(chapterPath.split('?')[1]);
    const url = params.get('url') || '';
    const mt = params.get('mt') || '';
    const lt = params.get('lt') || '';
    const lk = params.get('lk') || '';
    const ua = params.get('ua') || '';
    const referer = params.get('referer') || '';

    const fmt = detectStreamFormat(url, mt);

    const base: string[] = [
      '<meta name="lnreader-chapter-type" content="video">',
      '<meta id="no-cache-marker"/>',
      '<meta id="no-prefetch-marker"/>',
      '<meta id="lnreader-video-disable-progress"/>',
    ];

    // HLS / MP4 / WebM → direct mode (built-in player handles them)
    if (fmt === 'm3u8' || fmt === 'mp4' || fmt === 'webm') {
      const type = fmt === 'm3u8' ? 'm3u8' : 'video-file';
      return [
        ...base,
        '<meta name="lnreader-video-mode" content="direct">',
        `<meta name="lnreader-video-type" content="${type}">`,
        `<meta name="lnreader-video-url" content="${esc(url)}">`,
      ].join('\n');
    }

    // MPD / FLV / unknown → lazy mode → Shaka Player via customJS
    const attrs: string[] = ['id="m3u-shaka-container"'];
    attrs.push(`data-url="${esc(url)}"`);
    if (lt) attrs.push(`data-license-type="${esc(lt)}"`);
    if (lk) attrs.push(`data-license-key="${esc(lk)}"`);
    if (ua) attrs.push(`data-user-agent="${esc(ua)}"`);
    if (referer) attrs.push(`data-referer="${esc(referer)}"`);

    return [
      ...base,
      '<meta name="lnreader-video-mode" content="lazy">',
      `<div ${attrs.join(' ')} style="display:none;"></div>`,
    ].join('\n');
  }

  resolveUrl(path: string): string {
    return this.site;
  }
}

export default new M3UPlayerPlugin();
