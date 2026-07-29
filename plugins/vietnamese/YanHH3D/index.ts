import { fetchText } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as loadCheerio } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { ContentType } from '@libs/pluginMetadata';
import { encodeHtmlEntities } from '@libs/utils';
import { storage } from '@libs/storage';

import filters from './filters';

class YanHH3DPlugin implements Plugin.PluginBase {
  id = 'yanhh3d.love';
  name = 'YanHH3D';
  icon = 'src/vi/yanhh3d/icon.png';
  site = 'https://yanhh3d.love';
  version = '1.0.0';
  filters = filters;
  contentType = ContentType.VIDEO;

  customJS = 'src/vi/yanhh3d/player.js';

  pluginSettings: Plugin.PluginSettings = {
    debug: {
      value: true,
      label: 'Bật debug log',
      type: 'Switch',
    },
  };

  get enableDebug(): boolean {
    return storage.get('debug') as boolean;
  }

  imageRequestInit: Plugin.ImageRequestInit = {
    headers: {
      Referer: this.site + '/',
    },
  };

  // ---------- helpers ----------
  private urlToPath(url: string): string {
    if (url.startsWith(this.site)) {
      return url.slice(this.site.length);
    }
    return url;
  }

  private parseNovelsFromHtml(html: string): Plugin.NovelItem[] {
    const $ = loadCheerio(html);
    const novels: Plugin.NovelItem[] = [];

    $('.film_list-wrap .flw-item').each((_, el) => {
      const $el = $(el);
      const $link = $el.find('.film-name a').first();
      const name = $link.text().trim();
      let path = $link.attr('href') || '';
      path = this.urlToPath(path);
      if (!name || !path) return;

      const $img = $el.find('.film-poster img').first();
      let cover =
        $img.attr('src') || $img.attr('data-src') || defaultCover;

      novels.push({ name, path, cover });
    });

    return novels;
  }

  // ---------- Plugin API ----------
  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters: filterValues,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    let url: string;

    if (showLatestNovels) {
      url = `${this.site}/moi-cap-nhat?page=${pageNo}`;
    } else if (filterValues) {
      const category = filterValues.category?.value as string;
      const genre = filterValues.genre?.value as string;
      const path = genre || category || '/moi-cap-nhat';
      url = `${this.site}${path}?page=${pageNo}`;
    } else {
      url = `${this.site}/moi-cap-nhat?page=${pageNo}`;
    }

    const html = await fetchText(url);
    return this.parseNovelsFromHtml(html);
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const term = encodeURIComponent(searchTerm.trim());
    const url = `${this.site}/search?keysearch=${term}`;
    const html = await fetchText(url);
    return this.parseNovelsFromHtml(html);
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = this.site + novelPath;
    const html = await fetchText(url);
    const $ = loadCheerio(html);

    // Title
    const name = $('h1').first().text().trim();

    // Cover
    let cover = $('meta[property="og:image"]').attr('content') || defaultCover;
    if (cover && !cover.startsWith('http')) {
      cover = this.site + cover;
    }

    // Description
    let summary = $('.film-description .text').first().text().trim();
    // Remove trailing "btn-more-desc" text
    summary = summary.replace(/\+?\s*Xem thêm\s*$/, '').replace(/\+?\s*Thu gọn\s*$/, '').trim();

    // Status
    let status: string = NovelStatus.Unknown;
    const statusItem = $('.item.item-title').filter(function () {
      return $(this).find('.item-head').text().includes('Trạng thái');
    });
    const statusText = statusItem.text().toLowerCase();
    if (
      statusText.includes('hoàn thành') ||
      statusText.includes('completed') ||
      statusText.includes('full')
    ) {
      status = NovelStatus.Completed;
    } else if (
      statusText.includes('đang chiếu') ||
      statusText.includes('ongoing') ||
      statusText.includes('trailer') ||
      statusText.includes('/')
    ) {
      status = NovelStatus.Ongoing;
    }

    // Genres
    const genres: string[] = [];
    $('.item.item-title')
      .filter(function () {
        return $(this).find('.item-head').text().includes('Thể loại');
      })
      .find('a')
      .each((_, el) => {
        const g = $(el).text().trim();
        if (g) genres.push(g);
      });

    // Film buttons - determine which server types exist
    const filmButtons = $('.film-buttons a');
    const hasTM = filmButtons
      .filter(function () {
        return !$(this).hasClass('custom-button-sub');
      })
      .length > 0;
    const hasVS = filmButtons
      .filter(function () {
        return $(this).hasClass('custom-button-sub');
      })
      .length > 0;

    // Get the first episode URL from any available button to fetch the episode page
    const firstEpUrl = filmButtons.first().attr('href');

    // Fetch the episode page to get the full chapter list
    const chapters: Plugin.ChapterItem[] = [];

    if (firstEpUrl) {
      const epHtml = await fetchText(firstEpUrl);
      const $ep = loadCheerio(epHtml);

      // The episode page has tabs: "Thuyết Minh" and "Vietsub"
      // Each tab has its own tab-pane with episodes
      const tabPanes = $ep('.tab-pane');

      if (tabPanes.length > 0) {
        tabPanes.each((i, pane) => {
          const $pane = $(pane);
          // Determine volume name from tabs
          let volumeName = '';
          // Check if the corresponding tab nav-link is Thuyết Minh or Vietsub
          const tabLinks = $ep('.nav-tabs .nav-link');
          const tabLink = tabLinks.eq(i);
          const tabText = tabLink.text().trim();

          if (tabText.includes('Thuyết Minh')) {
            volumeName = 'Thuyết minh';
          } else if (tabText.includes('Vietsub')) {
            volumeName = 'Vietsub';
          } else {
            volumeName = tabText || `Volume ${i + 1}`;
          }

          // Check if this volume is relevant based on what the detail page has
          if (tabText.includes('Thuyết Minh') && !hasTM) return;
          if (tabText.includes('Vietsub') && !hasVS) return;

          const epRange = $pane.find('.ep-range');
          epRange.find('.ssl-item').each((_, epEl) => {
            const $epItem = $(epEl);
            const epPath = this.urlToPath($epItem.attr('href') || '');
            const epTitle = $epItem.attr('title') || '';
            const epOrder = $epItem.find('.ssli-order').text().trim();

            if (!epPath) return;

            const epName = epOrder || epTitle || epPath.split('/').pop() || '';

            chapters.push({
              name: epName,
              path: epPath,
              page: volumeName,
            });
          });
        });
      } else {
        // Fallback: no tabs, just a single list of episodes
        const epRange = $ep('.ep-range');
        epRange.find('.ssl-item').each((_, epEl) => {
          const $epItem = $(epEl);
          const epPath = this.urlToPath($epItem.attr('href') || '');
          const epTitle = $epItem.attr('title') || '';
          const epOrder = $epItem.find('.ssli-order').text().trim();

          if (!epPath) return;

          const epName = epOrder || epTitle || epPath.split('/').pop() || '';

          chapters.push({
            name: epName,
            path: epPath,
          });
        });
      }
    }

    return {
      path: novelPath,
      name,
      cover,
      summary,
      status,
      genres: genres.join(', '),
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = this.site + chapterPath;
    const html = await fetchText(url);

    // Extract server buttons with their text label (quality) and data-src
    // Pattern: full <a> tag with id, class, data-src
    const serverRegex =
      /<a\s[^>]*?id="(sv_[^"]+)"[^>]*?data-src="([^"]+)"[^>]*>([^<]*)<\/a>/g;
    // Also match reversed attribute order: data-src before id
    const serverRegex2 =
      /<a\s[^>]*?data-src="([^"]+)"[^>]*?id="(sv_[^"]+)"[^>]*>([^<]*)<\/a>/g;
    const servers: {
      name: string;
      label: string;
      url: string;
      quality: number;
    }[] = [];
    let match: RegExpExecArray | null;

    while ((match = serverRegex.exec(html)) !== null) {
      const name = match[1].replace('sv_', '');
      const dataSrc = match[2];
      const label = match[3].trim();
      // Deduplicate by URL
      if (servers.some(s => s.url === dataSrc)) continue;
      servers.push({
        name,
        label,
        url: dataSrc,
        quality: this.estimateQuality(label),
      });
    }
    while ((match = serverRegex2.exec(html)) !== null) {
      const dataSrc = match[1];
      const name = match[2].replace('sv_', '');
      const label = match[3].trim();
      if (servers.some(s => s.url === dataSrc)) continue;
      servers.push({
        name,
        label,
        url: dataSrc,
        quality: this.estimateQuality(label),
      });
    }

    if (servers.length === 0) {
      return (
        '<p style="color:#ff4444;text-align:center;padding:16px;">' +
        'Không tìm thấy nguồn video cho tập phim này.</p>' +
        '<meta id="no-cache-marker"/>' +
        '<meta id="no-prefetch-marker"/>'
      );
    }

    // Sort by quality descending: 4K > 1080 > HD > SD
    servers.sort((a, b) => b.quality - a.quality);
    const bestServer = servers[0];

    console.log(
      '[YHH3D] Servers:',
      servers.map(s => `${s.label}(${s.quality})`).join(', '),
    );
    console.log('[YHH3D] Best:', bestServer.label, bestServer.url);

    return this.buildPlayerHtml(bestServer.url, servers);
  }

  /** Map quality label to numeric score for sorting */
  private estimateQuality(label: string): number {
    const l = label.toLowerCase();
    if (/4k|2160/i.test(l)) return 4000;
    if (/1080|fhd/i.test(l)) return 1080;
    if (/720|hd/i.test(l)) return 720;
    if (/480|sd/i.test(l)) return 480;
    return 0;
  }

  // ---------- buildPlayerHtml ----------
  private buildPlayerHtml(
    m3u8Url: string,
    servers: { name: string; label: string; url: string; quality: number }[],
  ): string {
    const esc = (s: string) => encodeHtmlEntities(s);

    const metas: string[] = [
      '<meta name="lnreader-chapter-type" content="video">',
      `<meta name="lnreader-debug-mode" content="${this.enableDebug ? 'true' : 'false'}">`,
      '<meta id="no-cache-marker"/>',
      '<meta id="no-prefetch-marker"/>',
    ];

    // Pass the best m3u8 URL directly
    metas.push('<meta name="lnreader-video-mode" content="lazy">');

    const attrs: string[] = ['id="yanhh3d-player-container"'];
    attrs.push(`data-m3u8="${esc(m3u8Url)}"`);
    attrs.push(
      `data-all="${esc(JSON.stringify(servers.map(s => ({ label: s.label || s.name, url: s.url }))))}"`,
    );
    attrs.push(`data-debug="${this.enableDebug ? '1' : '0'}"`);

    metas.push(`<div ${attrs.join(' ')} style="display:none;"></div>`);

    return metas.join('\n');
  }
}

export default new YanHH3DPlugin();
