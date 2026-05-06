import { fetchApi, fetchText } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { Filters, FilterTypes } from '@libs/filterInputs';
import { load as loadCheerio } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

const SITE = 'https://animevietsub.bz';

class AnimeVietsubPlugin implements Plugin.PluginBase {
  id = 'animevietsub.bz';
  name = 'AnimeVietsub';
  icon = 'src/vi/animevietsub/icon.png';
  site = SITE;
  version = '1.0.0';

  imageRequestInit: Plugin.ImageRequestInit = {
    headers: {
      Referer: SITE + '/',
    },
  };

  filters = {
    category: {
      type: FilterTypes.Picker,
      label: 'Dạng Anime',
      value: '/anime-moi/',
      options: [
        { label: 'Anime Mới', value: '/anime-moi/' },
        { label: 'TV/Series', value: '/anime-bo/' },
        { label: 'Movie/OVA', value: '/anime-le/' },
        { label: 'Hoạt Hình Trung Quốc', value: '/hoat-hinh-trung-quoc/' },
        { label: 'Anime Sắp Chiếu', value: '/anime-sap-chieu/' },
        { label: 'Anime Đang Chiếu', value: '/danh-sach/list-dang-chieu/' },
        { label: 'Anime Trọn Bộ', value: '/danh-sach/list-tron-bo/' },
      ],
    },
    ranking: {
      type: FilterTypes.Picker,
      label: 'Top Anime (ưu tiên cao nhất)',
      value: '',
      options: [
        { label: 'Không dùng', value: '' },
        { label: 'Tổng hợp', value: '/bang-xep-hang.html' },
        { label: 'Theo Ngày', value: '/bang-xep-hang/day.html' },
        { label: 'Yêu Thích', value: '/bang-xep-hang/voted.html' },
        { label: 'Theo Tháng', value: '/bang-xep-hang/month.html' },
        { label: 'Theo Mùa', value: '/bang-xep-hang/season.html' },
        { label: 'Theo Năm', value: '/bang-xep-hang/year.html' },
      ],
    },
    genre: {
      type: FilterTypes.Picker,
      label: 'Thể loại',
      value: '',
      options: [
        { label: 'Tất cả', value: '' },
        { label: 'Action', value: 'hanh-dong' },
        { label: 'Adventure', value: 'phieu-luu' },
        { label: 'Boys Love', value: 'dong-tinh-nam' },
        { label: 'Cartoon', value: 'cartoon' },
        { label: 'Cổ Trang', value: 'co-trang' },
        { label: 'Comedy', value: 'hai-huoc' },
        { label: 'Dementia', value: 'dien-loan' },
        { label: 'Demons', value: 'demons' },
        { label: 'Drama', value: 'drama' },
        { label: 'Ecchi', value: 'ecchi' },
        { label: 'Fantasy', value: 'phep-thuat' },
        { label: 'Game', value: 'tro-choi' },
        { label: 'Harem', value: 'harem' },
        { label: 'Historical', value: 'lich-su' },
        { label: 'Horror', value: 'kinh-di' },
        { label: 'Josei', value: 'josei' },
        { label: 'Kids', value: 'tre-em' },
        { label: 'Live Action', value: 'live-action' },
        { label: 'Magic', value: 'ma-thuat' },
        { label: 'Martial Arts', value: 'martial-arts' },
        { label: 'Mecha', value: 'mecha' },
        { label: 'Military', value: 'quan-doi' },
        { label: 'Music', value: 'am-nhac' },
        { label: 'Mystery', value: 'mystery' },
        { label: 'Parody', value: 'parody' },
        { label: 'Police', value: 'police' },
        { label: 'Psychological', value: 'psychological' },
        { label: 'Romance', value: 'tinh-cam' },
        { label: 'Samurai', value: 'samurai' },
        { label: 'School', value: 'truong-hoc' },
        { label: 'Sci-Fi', value: 'sci-fi' },
        { label: 'Seinen', value: 'seinen' },
        { label: 'Shoujo', value: 'shoujo' },
        { label: 'Shoujo Ai', value: 'shoujo-ai' },
        { label: 'Shounen', value: 'shounen' },
        { label: 'Shounen Ai', value: 'shounen-ai' },
        { label: 'Slice of Life', value: 'doi-thuong' },
        { label: 'Space', value: 'space' },
        { label: 'Sports', value: 'the-thao' },
        { label: 'Super Power', value: 'super-power' },
        { label: 'Supernatural', value: 'sieu-nhien' },
        { label: 'Suspense', value: 'hoi-hop' },
        { label: 'Thriller', value: 'thriller' },
        { label: 'Tokusatsu', value: 'tokusatsu' },
        { label: 'Vampire', value: 'vampire' },
        { label: 'Yaoi', value: 'yaoi' },
        { label: 'Yuri', value: 'yuri' },
      ],
    },
    season: {
      type: FilterTypes.Picker,
      label: 'Season - Mùa',
      value: '',
      options: [
        { label: 'Không lọc', value: '' },
        { label: 'Mùa Đông', value: 'winter' },
        { label: 'Mùa Xuân', value: 'spring' },
        { label: 'Mùa Hạ', value: 'summer' },
        { label: 'Mùa Thu', value: 'autumn' },
      ],
    },
    year: {
      type: FilterTypes.Picker,
      label: 'Season - Năm',
      value: '2026',
      options: [
        { label: '2026', value: '2026' },
        { label: '2025', value: '2025' },
        { label: '2024', value: '2024' },
        { label: '2023', value: '2023' },
        { label: '2022', value: '2022' },
        { label: '2021', value: '2021' },
        { label: '2020', value: '2020' },
        { label: '2019', value: '2019' },
        { label: '2018', value: '2018' },
      ],
    },
  } satisfies Filters;

  // ---------- helpers ----------

  private absolutePath(href: string): string {
    if (!href) return '';
    try {
      const u = new URL(href, SITE);
      if (u.origin === SITE) return u.pathname + u.search;
      return href;
    } catch {
      return href;
    }
  }

  private parseListHtml(html: string): Plugin.NovelItem[] {
    const novels: Plugin.NovelItem[] = [];
    const $ = loadCheerio(html);
    const seen = new Set<string>();

    // Standard list: .MovieList .TPostMv
    $('.TPostMv').each((_, el) => {
      const $el = $(el);
      const $a = $el.find('article a').first();
      const href = $a.attr('href') || '';
      if (!href || !/\/phim\//.test(href)) return;
      const path = this.absolutePath(href);
      if (seen.has(path)) return;
      seen.add(path);
      const name =
        $el.find('h2.Title').first().text().trim() ||
        $el.find('.TPMvCn .Title').first().text().trim() ||
        $a.attr('title') ||
        '';
      const cover =
        $el.find('img').first().attr('src') ||
        $el.find('img').first().attr('data-src') ||
        defaultCover;
      if (name) {
        novels.push({ name, path, cover });
      }
    });

    // Ranking list: .row-display .e-item
    if (novels.length === 0) {
      $('.e-item, .row-display').each((_, el) => {
        const $el = $(el);
        const $a = $el.find('a.thumb, h3.title-item a, a').first();
        const href = $a.attr('href') || '';
        if (!href || !/\/phim\//.test(href)) return;
        const path = this.absolutePath(href);
        if (seen.has(path)) return;
        seen.add(path);
        const name =
          $el.find('h3.title-item').text().trim() ||
          $a.attr('title') ||
          '';
        const cover = $el.find('img').first().attr('src') || defaultCover;
        if (name) {
          novels.push({ name, path, cover });
        }
      });
    }

    return novels;
  }

  private buildListUrl(
    base: string,
    page: number,
    isRanking: boolean,
  ): string {
    if (isRanking) {
      // Ranking pages do not paginate — only return base for page 1
      return SITE + base;
    }
    if (page <= 1) return SITE + base;
    // Append trang-N.html
    if (base.endsWith('/')) return SITE + base + `trang-${page}.html`;
    if (base.endsWith('.html'))
      return SITE + base.replace(/\.html$/, `/trang-${page}.html`);
    return SITE + base + `/trang-${page}.html`;
  }

  // ---------- popularNovels ----------

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const ranking = filters?.ranking?.value || '';
    const season = filters?.season?.value || '';
    const year = filters?.year?.value || '';
    const genre = filters?.genre?.value || '';
    const category = filters?.category?.value || '/anime-moi/';

    let base = '/anime-moi/';
    let isRanking = false;

    if (showLatestNovels) {
      base = '/anime-moi/';
    } else if (ranking) {
      base = ranking;
      isRanking = true;
    } else if (season && year) {
      base = `/season/${season}/${year}/`;
    } else if (genre) {
      base = `/the-loai/${genre}/`;
    } else {
      base = category;
    }

    const url = this.buildListUrl(base, pageNo, isRanking);
    if (isRanking && pageNo > 1) return [];

    const html = await fetchText(url);
    return this.parseListHtml(html);
  }

  // ---------- searchNovels ----------

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const term = encodeURIComponent(searchTerm.trim());
    const url =
      pageNo <= 1
        ? `${SITE}/tim-kiem/${term}/F`
        : `${SITE}/tim-kiem/${term}/trang-${pageNo}.html`;
    const html = await fetchText(url);
    return this.parseListHtml(html);
  }

  // ---------- parseNovel ----------

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = SITE + novelPath;
    const html = await fetchText(url);
    const $ = loadCheerio(html);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name:
        $('header.Container h1.Title').first().text().trim() ||
        $('h1.Title').first().text().trim() ||
        $('meta[property="og:title"]').attr('content') ||
        '',
      cover:
        $('meta[property="og:image"]').attr('content') ||
        $('.TPostBg img').attr('src') ||
        $('.Image img').attr('src') ||
        defaultCover,
      summary:
        $('.Description').text().trim() ||
        $('meta[property="og:description"]').attr('content') ||
        '',
    };

    const genres: string[] = [];
    $('.InfoList a[href*="/the-loai/"]').each((_, el) => {
      const t = $(el).text().trim();
      if (t) genres.push(t);
    });
    if (genres.length) novel.genres = genres.join(', ');

    // Director/Studio as author
    $('.InfoList li').each((_, li) => {
      const label = $(li).find('strong').text().trim();
      if (/Đạo diễn/i.test(label)) {
        const author = $(li)
          .text()
          .replace(/Đạo diễn:?/i, '')
          .trim();
        if (author) novel.author = author;
      }
      if (/Trạng thái/i.test(label)) {
        const st = $(li)
          .text()
          .replace(/Trạng thái:?/i, '')
          .trim()
          .toLowerCase();
        if (/full|hoàn|complete/.test(st)) novel.status = NovelStatus.Completed;
        else if (/đang|tập/.test(st)) novel.status = NovelStatus.Ongoing;
        else novel.status = NovelStatus.Unknown;
      }
    });

    // Chapter list: detail page only shows latest 3 in "Tập mới".
    // To get the full episode list (server "AnimeVsub") we visit the
    // latest episode page and parse the list-server section.
    const latestEpHref = $('.InfoList li.latest_eps a').first().attr('href');
    if (latestEpHref) {
      try {
        const epPageUrl = latestEpHref.startsWith('http')
          ? latestEpHref
          : SITE + latestEpHref;
        const epHtml = await fetchText(epPageUrl);
        novel.chapters = this.parseEpisodeList(epHtml);
      } catch (e) {
        console.warn('AnimeVietsub: cannot fetch episode list page', e);
      }
    }

    return novel;
  }

  private parseEpisodeList(html: string): Plugin.ChapterItem[] {
    const $ = loadCheerio(html);
    const chapters: Plugin.ChapterItem[] = [];

    // Find the AnimeVsub server group
    let $group = $('#list-server .server-group').filter((_, el) => {
      return /AnimeVsub/i.test($(el).find('.server-name').text());
    });
    if ($group.length === 0) {
      // Fallback: take the first server-group available
      $group = $('#list-server .server-group').first();
    }

    const seen = new Set<string>();
    $group
      .find('ul.list-episode li.episode a.btn-episode')
      .each((idx, el) => {
        const $a = $(el);
        const href = $a.attr('href') || '';
        if (!href) return;
        const path = this.absolutePath(href);
        if (seen.has(path)) return;
        seen.add(path);
        const epLabel =
          $a.attr('title')?.trim() ||
          `Tập ${$a.text().trim()}`;
        const num = parseFloat(
          $a.text().replace(/[^0-9.]/g, ''),
        );
        chapters.push({
          name: epLabel,
          path,
          chapterNumber: Number.isFinite(num) ? num : idx + 1,
        });
      });

    return chapters;
  }

  // ---------- parseChapter ----------

  async parseChapter(chapterPath: string): Promise<string> {
    const url = SITE + chapterPath;
    const html = await fetchText(url);
    const $ = loadCheerio(html);

    // Find the matching episode link to get data-hash and data-id
    const cleanPath = chapterPath.split('?')[0].split('#')[0];
    let $link = $(
      `a.btn-episode.episode-link[href$="${cleanPath}"], a.btn-episode.episode-link[href*="${cleanPath}"]`,
    ).first();
    if ($link.length === 0) {
      // Fallback: active episode in the AnimeVsub server group
      $link = $('#list-server .server-group')
        .filter((_, el) =>
          /AnimeVsub/i.test($(el).find('.server-name').text()),
        )
        .find('a.btn-episode.active')
        .first();
    }
    if ($link.length === 0) {
      $link = $('a.btn-episode.episode-link.active').first();
    }
    if ($link.length === 0) {
      return '<p>Không tìm thấy thông tin tập phim. Vui lòng mở trực tiếp trên trang web.</p>';
    }

    const dataHash = $link.attr('data-hash') || '';
    const dataId = $link.attr('data-id') || '';

    if (!dataHash) {
      return '<p>Không tìm thấy mã tập phim (data-hash).</p>';
    }

    const body = new URLSearchParams();
    body.append('link', dataHash);
    if (dataId) body.append('id', dataId);

    const res = await fetchApi(`${SITE}/ajax/player`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: url,
      },
      body: body.toString(),
    });

    let json: {
      success?: number;
      playTech?: string;
      link?: string | any[];
      title?: string;
    } | null = null;
    try {
      json = await res.json();
    } catch (e) {
      const text = await res.text().catch(() => '');
      console.warn('AnimeVietsub: non-JSON player response', text.slice(0, 200));
    }

    if (!json || !json.success) {
      return '<p>Không lấy được link phát. Vui lòng thử lại sau.</p>';
    }

    const title =
      json.title ||
      $link.attr('title') ||
      `Tập ${$link.text().trim()}`;

    let playerHtml = '';
    if (json.playTech === 'iframe' && typeof json.link === 'string') {
      playerHtml = `<iframe src="${json.link}" width="100%" height="100%" frameborder="0" scrolling="no" allowfullscreen allow="autoplay; fullscreen"></iframe>`;
    } else if (
      (json.playTech === 'api' ||
        json.playTech === 'all' ||
        json.playTech === 'embed') &&
      Array.isArray(json.link)
    ) {
      // List of source files (m3u8/mp4) — render <video> with <source>s
      const sources = json.link as Array<{
        file?: string;
        type?: string;
        label?: string;
      }>;
      const sourceTags = sources
        .map(s => {
          const file = (s.file || '').replace(/^&http/, 'http');
          if (!file) return '';
          const type =
            s.type === 'hls' || /\.m3u8(\?|$)/i.test(file)
              ? 'application/x-mpegURL'
              : s.type
                ? `video/${s.type}`
                : 'video/mp4';
          return `<source src="${file}" type="${type}" />`;
        })
        .filter(Boolean)
        .join('');
      playerHtml = `<video controls width="100%" height="100%" playsinline>${sourceTags}Trình duyệt của bạn không hỗ trợ thẻ video.</video>`;
    } else if (json.playTech === 'embed' && typeof json.link === 'string') {
      playerHtml = `<video controls width="100%" height="100%" playsinline><source src="${json.link}" /></video>`;
    } else if (typeof json.link === 'string') {
      playerHtml = `<iframe src="${json.link}" width="100%" height="100%" frameborder="0" scrolling="no" allowfullscreen allow="autoplay; fullscreen"></iframe>`;
    } else {
      return '<p>Định dạng phát không được hỗ trợ.</p>';
    }

    // Wrap player in a 16:9 responsive container without any extra text body.
    return `<div style="position:relative;width:100%;padding-bottom:56.25%;background:#000;">
  <div style="position:absolute;top:0;left:0;width:100%;height:100%;">
    ${playerHtml}
  </div>
</div>`;
  }
}

export default new AnimeVietsubPlugin();
