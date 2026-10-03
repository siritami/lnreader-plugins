import { defaultCover } from '@libs/defaultCover';
import { fetchApi, fetchText } from '@libs/fetch';
import { NovelStatus } from '@libs/novelStatus';
import { NekoriBasePlugin } from '@nekori/plugin';
import { ContentType, ContentWarning } from '@nekori/pluginMetadata';
import { Buffer, decodeHtmlEntities } from '@nekori/utils';

import { Plugin } from '@/types/plugin';

import filters from './filters';

const SITE = 'https://yanhh3d.ee';
const DEFAULT_CDN_HOSTS = [
  'photos.donghuavip13.com',
  'photos.donghuavip2.com',
  'photos.donghuavip14.com',
  'photos.donghuavip12.com',
  'photos.donghuavip15.com',
  'photos.donghuavip3.com',
  'photos.donghuavip4.com',
];

type WPPost = {
  id: number;
  slug: string;
  link?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
  status?: number[];
  categories?: number[];
  _embedded?: {
    'wp:featuredmedia'?: Array<{ source_url?: string }>;
    'wp:term'?: Array<Array<{ name?: string; slug?: string }>>;
  };
};

function cleanHtml(html: string | undefined): string {
  if (!html) return '';
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, '').trim());
}

function parsePostList(posts: WPPost[]): Plugin.NovelItem[] {
  return posts.flatMap(post => {
    if (!post.slug || !post.title?.rendered) return [];
    const name = decodeHtmlEntities(post.title.rendered.trim());
    const path = post.link ? new URL(post.link).pathname : `/${post.slug}`;
    const cover =
      post._embedded?.['wp:featuredmedia']?.[0]?.source_url || defaultCover;
    return [{ name, path, cover }];
  });
}

function statusOf(statusArr?: number[]): string {
  if (!statusArr || statusArr.length === 0) return NovelStatus.Unknown;
  if (statusArr.includes(12)) return NovelStatus.Completed;
  if (statusArr.includes(2)) return NovelStatus.Ongoing;
  return NovelStatus.Unknown;
}

class YanHH3DPlugin extends NekoriBasePlugin {
  id = 'yanhh3d';
  name = 'YanHH3D';
  icon = 'icon.png';
  site = SITE;
  version = '1.0.4';
  customJS = 'player.js';
  customCSS = 'style.css';
  contentType = ContentType.VIDEO;
  contentWarning = ContentWarning.SAFE;

  filters = filters;

  imageRequestInit: Plugin.ImageRequestInit = {
    headers: { Referer: `${this.site}/` },
  };

  private async getJson<T>(url: string): Promise<T | null> {
    try {
      const response = await fetchApi(url, {
        headers: {
          Accept: 'application/json',
          Referer: `${this.site}/`,
        },
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  async popularNovels(
    pageNo: number,
    options: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const params = new URLSearchParams({
      page: String(pageNo),
      per_page: '24',
      _embed: '1',
    });

    if (options.showLatestNovels) {
      params.set('orderby', 'modified');
      params.set('order', 'desc');
    } else {
      const selected = options.filters;
      params.set('orderby', String(selected?.orderby?.value || 'modified'));
      params.set('order', String(selected?.order?.value || 'desc'));

      const cat = selected?.category?.value;
      if (cat) params.set('categories', String(cat));

      const st = selected?.status?.value;
      if (st) params.set('status', String(st));

      const showtimes = selected?.showtimes?.value;
      if (showtimes) params.set('showtimes', String(showtimes));
    }

    const posts = await this.getJson<WPPost[]>(
      `${this.site}/wp-json/wp/v2/posts?${params.toString()}`,
    );
    if (!posts || !Array.isArray(posts)) return [];
    return parsePostList(posts);
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const trimmed = searchTerm.trim();
    if (!trimmed) return [];

    const params = new URLSearchParams({
      search: trimmed,
      page: String(pageNo),
      per_page: '24',
      _embed: '1',
    });

    const posts = await this.getJson<WPPost[]>(
      `${this.site}/wp-json/wp/v2/posts?${params.toString()}`,
    );
    if (!posts || !Array.isArray(posts)) return [];
    return parsePostList(posts);
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const cleanPath = novelPath.split('?')[0].replace(/\/+$/, '');
    const segments = cleanPath.split('/').filter(Boolean);
    const slug = segments[segments.length - 1] || '';

    // Fetch WP Post data for full metadata
    let post: WPPost | null = null;
    if (slug) {
      const posts = await this.getJson<WPPost[]>(
        `${this.site}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_embed=1`,
      );
      if (posts && posts.length > 0) {
        post = posts[0];
      }
    }

    // Fetch movie detail HTML to scrape episodes and post ID if needed
    const movieUrl = post?.link || `${this.site}${cleanPath}`;
    const html = await fetchText(movieUrl, {
      headers: { Referer: `${this.site}/` },
    });

    const postId =
      post?.id ??
      (() => {
        const m =
          html.match(/data-post(?:-id)?="(\d+)"/) ||
          html.match(/post_id[:=]\s*"?(\d+)"?/) ||
          html.match(/class="[^"]*post-(\d+)[^"]*"/);
        return m ? parseInt(m[1], 10) : undefined;
      })();

    // Extract episodes from HTML
    const epMatches = [...html.matchAll(/data-ep="tap-(\d+)"/g)].map(m =>
      parseInt(m[1], 10),
    );
    const episodeNumbers = [...new Set(epMatches)].sort((a, b) => a - b);

    const chapters: Plugin.ChapterItem[] = episodeNumbers.map(ep => ({
      name: `Tập ${ep}`,
      path: `${cleanPath}/tap-${ep}.html?post_id=${postId ?? ''}&ep=${ep}`,
      chapterNumber: ep,
      page: 'YanHH3D',
    }));

    // Extract genres from WP terms or fallback
    const genres: string[] = [];
    if (post?._embedded?.['wp:term']) {
      for (const termGroup of post._embedded['wp:term']) {
        for (const term of termGroup) {
          if (term.name) genres.push(term.name);
        }
      }
    }

    const title = post?.title?.rendered
      ? decodeHtmlEntities(post.title.rendered.trim())
      : (html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim() || slug);

    const summary = cleanHtml(post?.excerpt?.rendered || post?.content?.rendered);
    const cover =
      post?._embedded?.['wp:featuredmedia']?.[0]?.source_url || defaultCover;

    return {
      path: novelPath,
      name: title,
      cover,
      summary,
      author: 'Hoạt hình 3D Trung Quốc',
      genres: genres.join(', '),
      status: statusOf(post?.status),
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<Plugin.ChapterContent> {
    const cleanPath = chapterPath.split('?')[0];
    const postIdMatch = chapterPath.match(/[?&]post_id=(\d+)/);
    const epMatch =
      chapterPath.match(/[?&]ep=(\d+)/) || chapterPath.match(/tap-(\d+)/);

    let postId = postIdMatch ? postIdMatch[1] : '';
    const ep = epMatch ? epMatch[1] : '1';

    // Fetch episode page to scrape available servers and postId if needed
    const epUrl = `${this.site}${cleanPath}`;
    const epHtml = await fetchText(epUrl, {
      headers: { Referer: `${this.site}/` },
    });

    if (!postId) {
      const m =
        epHtml.match(/data-post(?:-id)?="(\d+)"/) ||
        epHtml.match(/post_id[:=]\s*"?(\d+)"?/);
      if (m) postId = m[1];
    }

    if (!postId) {
      return {
        state: 'checkpoint',
        type: 'video',
        noCache: true,
        noPrefetch: true,
        html: '<p style="color:#ff4444;text-align:center;padding:16px;">Không tìm thấy thông tin tập phim.</p>',
        checkpointMessage: 'Không tìm thấy thông tin tập phim',
      };
    }

    // Detect available server options on episode page
    const foundTypes: string[] = [];
    const serverRegex = /data-type="([^"]+)"/g;
    let sm;
    while ((sm = serverRegex.exec(epHtml)) !== null) {
      foundTypes.push(sm[1]);
    }

    const serverDefinitions = [
      {
        primary: 'vip4k',
        fallback: 'vip4k_v2',
        name: '4K Vietsub',
        res: '3840x2160',
        bw: 15000000,
        enabled: foundTypes.includes('vip4k') || foundTypes.includes('vip4k_v2'),
      },
      {
        primary: 'pro',
        fallback: 'tiktik',
        name: '1080p Vietsub',
        res: '1920x1080',
        bw: 6000000,
        enabled: foundTypes.includes('pro') || foundTypes.includes('tiktik') || foundTypes.length === 0,
      },
      {
        primary: 'vip4ktm',
        fallback: 'vip4ktm_v2',
        name: '4K Thuyết Minh',
        res: '3840x2160',
        bw: 15000000,
        enabled: foundTypes.includes('vip4ktm') || foundTypes.includes('vip4ktm_v2'),
      },
      {
        primary: 'pro_tm',
        fallback: 'tiktm',
        name: '1080p Thuyết Minh',
        res: '1920x1080',
        bw: 6000000,
        enabled: foundTypes.includes('pro_tm') || foundTypes.includes('tiktm'),
      },
    ];

    const activeServers = serverDefinitions.filter(s => s.enabled);
    if (activeServers.length === 0) {
      activeServers.push(serverDefinitions[1]); // fallback 1080p
    }

    const resolveStream = async (s: (typeof serverDefinitions)[0]) => {
      const candidates = [s.primary, s.fallback];
      for (const type of candidates) {
        try {
          const playerUrl = `${this.site}/player/player.php?action=dox_ajax_player&post_id=${postId}&chapter_st=tap-${ep}&type=${type}&sv=1`;
          const playerHtml = await fetchText(playerUrl, {
            headers: {
              Referer: `${this.site}/`,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
          });
          const match = playerHtml.match(/embed\/vt?\/([A-Za-z0-9]+)/);
          if (match && match[1]) {
            const vid = match[1];
            // Probe CDN
            for (const host of DEFAULT_CDN_HOSTS) {
              try {
                const res = await fetchApi(`https://${host}/${vid}/index.m3u8`, {
                  method: 'HEAD',
                });
                if (res.status === 200) {
                  return {
                    name: s.name,
                    res: s.res,
                    bw: s.bw,
                    url: `https://${host}/${vid}/index.m3u8`,
                  };
                }
              } catch {}
            }
            return {
              name: s.name,
              res: s.res,
              bw: s.bw,
              url: `https://${DEFAULT_CDN_HOSTS[0]}/${vid}/index.m3u8`,
            };
          }
        } catch {}
      }
      return null;
    };

    const resolvedVariants = (
      await Promise.all(activeServers.map(s => resolveStream(s)))
    ).filter(Boolean) as Array<{
      name: string;
      res: string;
      bw: number;
      url: string;
    }>;

    if (resolvedVariants.length === 0) {
      return {
        state: 'checkpoint',
        type: 'video',
        noCache: true,
        noPrefetch: true,
        html: '<p style="color:#ff4444;text-align:center;padding:16px;">Không tìm thấy stream video cho tập phim này.</p>',
        checkpointMessage: 'Không tìm thấy video stream',
      };
    }

    let finalVideoUrl = resolvedVariants[0].url;

    if (resolvedVariants.length > 1) {
      let masterText = '#EXTM3U\n#EXT-X-VERSION:3\n';
      for (const v of resolvedVariants) {
        masterText += `#EXT-X-STREAM-INF:BANDWIDTH=${v.bw},RESOLUTION=${v.res},NAME="${v.name}"\n`;
        masterText += `${v.url}\n`;
      }
      finalVideoUrl = `data:application/vnd.apple.mpegurl;base64,${Buffer.from(masterText).toString('base64')}`;
    }

    return {
      state: 'ready',
      type: 'video',
      noCache: true,
      noPrefetch: true,
      html: [
        '<meta name="lnreader-video-mode" content="direct">',
        '<meta name="lnreader-video-type" content="m3u8">',
        `<meta name="lnreader-video-url" content="${finalVideoUrl}">`,
      ].join('\n'),
    };
  }

  resolveUrl(path: string): string {
    const clean = path.split('?')[0];
    return clean.startsWith('http') ? clean : `${this.site}${clean}`;
  }
}

export default new YanHH3DPlugin();
