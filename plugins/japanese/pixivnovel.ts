import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { FilterTypes, Filters } from '@libs/filterInputs';

class PixivNovelPlugin implements Plugin.PagePlugin {
  id = 'pixiv.novel';
  name = 'Pixiv Novel';
  icon = 'src/jp/pixivnovel/icon.png';
  site = 'https://www.pixiv.net';
  version = '1.0.1';

  imageRequestInit = {
    headers: {
      'Referer': 'https://www.pixiv.net',
    },
  };

  private headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Referer': 'https://www.pixiv.net',
    'Accept': 'application/json',
  };

  /**
   * Fetch JSON from Pixiv AJAX API
   */
  private async fetchJson(url: string): Promise<any> {
    const result = await fetchApi(url, { headers: this.headers });
    const json = await result.json();
    if (json.error) {
      if (json.message === 'Ranking could not be found. Please try again.') {
        throw new Error('Please log in to Pixiv via WebView to view R-18 content. / R-18コンテンツを閲覧するには、WebViewからPixivにログインしてください。');
      }
      throw new Error(json.message || 'Pixiv API error');
    }
    return json.body;
  }

  /**
   * Convert pixiv novel text formatting to HTML
   * Pixiv uses custom tags like [chapter:Title], [newpage], [pixivimage:id], [rb: text > ruby]
   */
  private pixivContentToHtml(content: string): string {
    let html = content;

    html = html.replace(/\n/g, '<br/>');

    return html;
  }

  /**
   * Get popular novel series from genre page
   * Supports genre-specific and R-18 sub-category URLs
   */
  async popularNovels(
    pageNo: number,
    options: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];

    const mode = options.filters?.mode?.value || 'safe';
    const genre = options.filters?.genre?.value || 'all';
    let url: string;
    if ((mode == 'safe' && (genre == 'male' || genre == 'female')) || (mode == 'r18' && (genre == 'all' || genre == 'for_kids'))) {
      throw new Error(
        `Không tồn tại thể loại ${genre} trong mode : ${mode == 'safe' ? 'all ages' : 'r18'}`
      );
    }
    url = `${this.site}/ajax/genre/novel/${genre}?mode=${mode}&lang=en`;
    const body = await this.fetchJson(url);
    const novels: Plugin.NovelItem[] = [];
    const seriesList = body?.thumbnails?.novelSeries || [];

    for (const series of seriesList) {
      const coverUrl =
        series.cover?.urls?.['480mw'] ||
        series.cover?.urls?.['240mw'] ||
        '';
      const newURL = '/' + coverUrl;
      const isOneshot = series.isOneshot === true;
      const path = isOneshot
        ? `/novel/show.php?id=${series.novelId}`
        : `/novel/series/${series.id}`;

      novels.push({
        name: series.title || '',
        path,
        cover: newURL || defaultCover,
      });
    }

    return novels;
  }

  /**
   * Parse novel metadata - handles both series and oneshot novels
   */
  async parseNovel(
    novelPath: string,
  ): Promise<Plugin.SourceNovel & { totalPages: number }> {
    const seriesMatch = novelPath.match(/\/novel\/series\/(\d+)/);

    if (seriesMatch) {
      return this.parseSeriesNovel(seriesMatch[1], novelPath);
    }

    // Oneshot novel - /novel/show.php?id=XXX
    const novelIdMatch = novelPath.match(/id=(\d+)/);
    if (novelIdMatch) {
      return this.parseOneshotNovel(novelIdMatch[1], novelPath);
    }

    throw new Error('Invalid novel path');
  }

  /**
   * Parse a series novel with multiple chapters
   */
  private async parseSeriesNovel(
    seriesId: string,
    novelPath: string,
  ): Promise<Plugin.SourceNovel & { totalPages: number }> {
    // Get series metadata
    const seriesBody = await this.fetchJson(
      `${this.site}/ajax/novel/series/${seriesId}?lang=en`,
    );

    // Get first page of chapters (30 per page)
    const contentBody = await this.fetchJson(
      `${this.site}/ajax/novel/series_content/${seriesId}?limit=30&last_order=0&order_by=asc&lang=en`,
    );

    const coverUrl =
      seriesBody.cover?.urls?.['480mw'] ||
      seriesBody.cover?.urls?.['240mw'] ||
      seriesBody.firstEpisode?.url ||
      '';

    // Parse chapters from page.seriesContents
    const seriesContents = contentBody?.page?.seriesContents || [];
    const chapters: Plugin.ChapterItem[] = seriesContents.map(
      (item: any, index: number) => ({
        name: item.title || `Chapter ${index + 1}`,
        path: `/ajax/novel/${item.id}`,
        chapterNumber: item.series?.contentOrder || index + 1,
        releaseTime: item.uploadTimestamp
          ? new Date(item.uploadTimestamp * 1000).toISOString()
          : '',
      }),
    );

    // Calculate total pages
    const totalEpisodes = seriesBody.publishedContentCount || seriesBody.total || chapters.length;
    const totalPages = Math.max(1, Math.ceil(totalEpisodes / 30));

    // Build tag/genre list
    const tags: string[] = seriesBody.tags || [];

    // Clean up caption HTML for summary
    let summary = seriesBody.caption || '';
    summary = summary.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');

    const novel: Plugin.SourceNovel & { totalPages: number } = {
      path: novelPath,
      name: seriesBody.title || 'Untitled',
      author: seriesBody.userName || '',
      summary,
      genres: tags.join(','),
      cover: coverUrl || defaultCover,
      status: seriesBody.isConcluded
        ? NovelStatus.Completed
        : NovelStatus.Ongoing,
      chapters,
      totalPages,
    };

    return novel;
  }

  /**
   * Parse a oneshot (single-chapter) novel
   */
  private async parseOneshotNovel(
    novelId: string,
    novelPath: string,
  ): Promise<Plugin.SourceNovel & { totalPages: number }> {
    const body = await this.fetchJson(
      `${this.site}/ajax/novel/${novelId}?lang=en`,
    );

    const coverUrl = body.coverUrl || '';
    const tags: string[] = (body.tags?.tags || []).map(
      (t: any) => t.tag || '',
    );

    // Clean summary
    let summary = body.description || '';
    summary = summary.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');

    return {
      path: novelPath,
      name: body.title || 'Untitled',
      author: body.userName || '',
      summary,
      genres: tags.join(','),
      cover: coverUrl || defaultCover,
      status: NovelStatus.Completed,
      chapters: [
        {
          name: body.title || 'Chapter 1',
          path: `/ajax/novel/${novelId}`,
          releaseTime: body.createDate || '',
        },
      ],
      totalPages: 1,
    };
  }

  /**
   * Parse additional pages of chapters for series with 30+ chapters
   */
  async parsePage(
    novelPath: string,
    page: string,
  ): Promise<Plugin.SourcePage> {
    const seriesMatch = novelPath.match(/\/novel\/series\/(\d+)/);
    if (!seriesMatch) return { chapters: [] };

    const seriesId = seriesMatch[1];
    const pageNum = parseInt(page);
    const lastOrder = (pageNum - 1) * 30;

    const contentBody = await this.fetchJson(
      `${this.site}/ajax/novel/series_content/${seriesId}?limit=30&last_order=${lastOrder}&order_by=asc&lang=en`,
    );

    const seriesContents = contentBody?.page?.seriesContents || [];
    const chapters: Plugin.ChapterItem[] = seriesContents.map(
      (item: any, index: number) => ({
        name: item.title || `Chapter ${lastOrder + index + 1}`,
        path: `/ajax/novel/${item.id}`,
        chapterNumber: item.series?.contentOrder || lastOrder + index + 1,
        releaseTime: item.uploadTimestamp
          ? new Date(item.uploadTimestamp * 1000).toISOString()
          : '',
      }),
    );

    return { chapters };
  }

  /**
   * Parse chapter content
   */
  async parseChapter(chapterPath: string): Promise<string> {
    const novelIdMatch = chapterPath.match(/\/ajax\/novel\/(\d+)/);
    if (!novelIdMatch) return '';

    const body = await this.fetchJson(
      `${this.site}/ajax/novel/${novelIdMatch[1]}?lang=en`,
    );

    const content = body?.content || '';
    return this.pixivContentToHtml(content);
  }

  /**
   * Search novels by keyword
   */
  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const encodedTerm = encodeURIComponent(searchTerm);
    const url = `${this.site}/ajax/search/novels/${encodedTerm}?word=${encodedTerm}&order=date_d&mode=all&p=${pageNo}&s_mode=s_tag&lang=en`;

    const body = await this.fetchJson(url);
    const novels: Plugin.NovelItem[] = [];

    // Novels from search results
    const data = body?.novel?.data || [];
    const seenPaths = new Set<string>();

    for (const item of data) {
      const path = item.seriesId
        ? `/novel/series/${item.seriesId}`
        : `/novel/show.php?id=${item.id}`;

      // Deduplicate series
      if (seenPaths.has(path)) continue;
      seenPaths.add(path);

      novels.push({
        name: item.title || '',
        path,
        cover: item.url || defaultCover,
      });
    }

    return novels;
  }

  resolveUrl(path: string, isNovel?: boolean): string {
    if (path.startsWith('http')) return path;
    return `${this.site}${path}`;
  }

  filters = {
    mode: {
      type: FilterTypes.Picker,
      label: 'Mode',
      value: 'safe',
      options: [
        { label: 'All Ages (全年齢)', value: 'safe' },
        { label: 'R-18 (※要ログイン)', value: 'r18' },
      ],
    },
    genre: {
      type: FilterTypes.Picker,
      label: 'Genre',
      value: 'all',
      options: [
        { label: 'All Genres (すべて) - Only All Ages (全年齢のみ)', value: 'all' },
        { label: 'Romance (恋愛)', value: 'romance' },
        { label: 'Isekai Fantasy (異世界ファンタジー)', value: 'isekai_fantasy' },
        { label: 'Contemporary Fantasy (現代ファンタジー)', value: 'contemporary_fantasy' },
        { label: 'Mystery (ミステリー)', value: 'mystery' },
        { label: 'Horror (ホラー)', value: 'horror' },
        { label: 'Sci-Fi (SF)', value: 'sci-fi' },
        { label: 'Literature (純文学)', value: 'literature' },
        { label: 'Drama (ヒューマンドラマ)', value: 'drama' },
        { label: 'Historical pieces (歴史・時代)', value: 'historical_pieces' },
        { label: 'BL (ボーイズラブ)', value: 'bl' },
        { label: 'Yuri (百合)', value: 'yuri' },
        { label: 'For Kids (童話) - Only All Ages (全年齢のみ)', value: 'for_kids' },
        { label: 'Poetry (詩)', value: 'poetry' },
        { label: 'Essays/non-fiction (ノンフィクション)', value: 'non_fiction' },
        { label: 'Screenplays (脚本)', value: 'screenplays' },
        { label: 'Reviews (レビュー)', value: 'reviews' },
        { label: 'Other (その他)', value: 'other' },
        { label: 'Popular with male (男性に人気) - Only R18 (R18のみ)', value: 'male' },
        { label: 'Popular with female (女性に人気) - Only R18 (R18のみ)', value: 'female' },
      ],
    },
  } satisfies Filters;
}

export default new PixivNovelPlugin();
