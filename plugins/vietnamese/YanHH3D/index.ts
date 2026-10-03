import { defaultCover } from '@libs/defaultCover';
import { fetchApi, fetchText } from '@libs/fetch';
import { NovelStatus } from '@libs/novelStatus';
import { NekoriBasePlugin } from '@nekori/plugin';
import { ContentType, ContentWarning } from '@nekori/pluginMetadata';
import { decodeHtmlEntities } from '@nekori/utils';

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
  version = '1.0.2';
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

    // Detect server options from episode page
    const foundTypes: string[] = [];
    const serverRegex = /data-type="([^"]+)"/g;
    let sm;
    while ((sm = serverRegex.exec(epHtml)) !== null) {
      foundTypes.push(sm[1]);
    }

    const availableButtons: Array<{ type: string; name: string }> = [];
    if (foundTypes.includes('vip4k') || foundTypes.includes('vip4k_v2')) {
      availableButtons.push({ type: 'vip4k', name: '4K Vietsub' });
    }
    if (foundTypes.includes('pro') || foundTypes.includes('tiktik') || availableButtons.length === 0) {
      availableButtons.push({ type: 'pro', name: '1080p Vietsub' });
    }
    if (foundTypes.includes('vip4ktm') || foundTypes.includes('vip4ktm_v2')) {
      availableButtons.push({ type: 'vip4ktm', name: '4K Thuyết Minh' });
    }
    if (foundTypes.includes('pro_tm') || foundTypes.includes('tiktm')) {
      availableButtons.push({ type: 'pro_tm', name: '1080p Thuyết Minh' });
    }

    // Default: 4K Vietsub if available, otherwise switch back to 1080p Vietsub
    let activeServer = 'pro';
    if (availableButtons.some(b => b.type === 'vip4k')) {
      activeServer = 'vip4k';
    } else if (availableButtons.some(b => b.type === 'pro')) {
      activeServer = 'pro';
    } else if (availableButtons.length > 0) {
      activeServer = availableButtons[0].type;
    }

    const candidateList =
      activeServer === 'vip4k'
        ? ['vip4k', 'vip4k_v2', 'pro', 'tiktik']
        : ['pro', 'tiktik', 'vip4k', 'vip4k_v2'];

    let foundVid: string | null = null;
    let actualServer = activeServer;

    for (const s of candidateList) {
      try {
        const playerUrl = `${this.site}/player/player.php?action=dox_ajax_player&post_id=${postId}&chapter_st=tap-${ep}&type=${s}&sv=1`;
        const playerHtml = await fetchText(playerUrl, {
          headers: {
            Referer: `${this.site}/`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
        });
        const match = playerHtml.match(/embed\/vt?\/([A-Za-z0-9]+)/);
        if (match && match[1]) {
          foundVid = match[1];
          actualServer = s.includes('4k') ? 'vip4k' : 'pro';
          break;
        }
      } catch {
        // Continue fallback
      }
    }

    if (!foundVid) {
      return {
        state: 'checkpoint',
        type: 'video',
        noCache: true,
        noPrefetch: true,
        html: '<p style="color:#ff4444;text-align:center;padding:16px;">Không tìm thấy stream video cho tập phim này.</p>',
        checkpointMessage: 'Không tìm thấy video stream',
      };
    }

    const probePromises = DEFAULT_CDN_HOSTS.map(async host => {
      try {
        const res = await fetchApi(`https://${host}/${foundVid}/index.m3u8`, {
          method: 'HEAD',
        });
        if (res.status === 200) return `https://${host}`;
      } catch {
        // ignore error
      }
      return null;
    });
    const results = await Promise.all(probePromises);
    const workingCdn = results.find(Boolean) || `https://${DEFAULT_CDN_HOSTS[0]}`;

    const videoUrl = `${workingCdn}/${foundVid}/index.m3u8`;

    const buttonsHtml = availableButtons
      .map(
        b =>
          `<button type="button" class="yan-btn ${b.type === actualServer ? 'active' : ''}" data-type="${b.type}">${b.name}</button>`,
      )
      .join('\n      ');

    const htmlContent = [
      '<meta name="lnreader-video-mode" content="direct">',
      '<meta name="lnreader-video-type" content="m3u8">',
      `<meta name="lnreader-video-url" content="${videoUrl}">`,
      `<style>
        .yan-server-bar {
          margin: 16px auto;
          padding: 14px 16px;
          max-width: 800px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #e0e0e0;
          box-sizing: border-box;
        }
        .yan-server-title {
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #9e9e9e;
          margin-bottom: 10px;
        }
        .yan-server-buttons {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .yan-btn {
          appearance: none;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 8px;
          color: #f5f5f5;
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          user-select: none;
          outline: none;
        }
        .yan-btn:hover {
          background: rgba(255, 255, 255, 0.16);
          border-color: rgba(255, 255, 255, 0.3);
        }
        .yan-btn.active {
          background: #3b82f6;
          border-color: #60a5fa;
          color: #ffffff;
          box-shadow: 0 0 12px rgba(59, 130, 246, 0.5);
          font-weight: 600;
        }
        .yan-btn.loading {
          opacity: 0.6;
          pointer-events: none;
        }
        .yan-server-status {
          margin-top: 8px;
          font-size: 12px;
          color: #60a5fa;
          min-height: 16px;
        }
      </style>`,
      `<div id="yan-server-bar" class="yan-server-bar" data-post-id="${postId}" data-ep="${ep}" data-active="${actualServer}" data-site="${this.site}" data-cdn-hosts="${DEFAULT_CDN_HOSTS.join(',')}">
        <div class="yan-server-title">Đổi Server / Độ phân giải:</div>
        <div class="yan-server-buttons">
          ${buttonsHtml}
        </div>
        <div id="yan-server-status" class="yan-server-status"></div>
      </div>`,
      `<script>
      (function() {
        var bar = document.getElementById('yan-server-bar');
        if (!bar || bar.dataset.bound) return;
        bar.dataset.bound = 'true';

        var postId = bar.getAttribute('data-post-id');
        var ep = bar.getAttribute('data-ep');
        var site = bar.getAttribute('data-site') || 'https://yanhh3d.ee';
        var cdnHosts = (bar.getAttribute('data-cdn-hosts') || '').split(',').filter(Boolean);
        var statusEl = document.getElementById('yan-server-status');

        function setStatus(msg, isErr) {
          if (!statusEl) return;
          statusEl.textContent = msg;
          statusEl.style.color = isErr ? '#ef4444' : '#60a5fa';
        }

        var fallbacks = {
          vip4k: ['vip4k', 'vip4k_v2', 'pro', 'tiktik'],
          pro: ['pro', 'tiktik', 'vip4k', 'vip4k_v2'],
          vip4ktm: ['vip4ktm', 'vip4ktm_v2', 'pro_tm', 'tiktm'],
          pro_tm: ['pro_tm', 'tiktm', 'vip4ktm', 'vip4ktm_v2']
        };

        async function findCdn(vid) {
          for (var i = 0; i < cdnHosts.length; i++) {
            try {
              var r = await fetch('https://' + cdnHosts[i] + '/' + vid + '/index.m3u8', { method: 'HEAD' });
              if (r.status === 200) return 'https://' + cdnHosts[i];
            } catch(e) {}
          }
          return 'https://' + cdnHosts[0];
        }

        var btns = bar.querySelectorAll('.yan-btn');
        btns.forEach(function(b) {
          b.addEventListener('click', async function() {
            var target = b.getAttribute('data-type');
            if (!target || !window.LNReaderPlayer) return;
            if (b.classList.contains('active')) return;

            btns.forEach(function(btn) { btn.classList.add('loading'); });
            setStatus('Đang tải stream ' + b.textContent.trim() + '...');

            try {
              var candidates = fallbacks[target] || [target];
              var vid = null;
              for (var c of candidates) {
                var purl = site + '/player/player.php?action=dox_ajax_player&post_id=' + postId + '&chapter_st=tap-' + ep + '&type=' + c + '&sv=1';
                var pr = await fetch(purl, { headers: { Referer: site + '/' } });
                var pt = await pr.text();
                var m = pt.match(/embed\\/vt?\\/([A-Za-z0-9]+)/);
                if (m && m[1]) { vid = m[1]; break; }
              }
              if (!vid) throw new Error('Không tìm thấy stream');

              var cdn = await findCdn(vid);
              var m3u8 = cdn + '/' + vid + '/index.m3u8';
              window.LNReaderPlayer.playHls(m3u8);

              btns.forEach(function(btn) { btn.classList.remove('active'); });
              b.classList.add('active');
              setStatus('Đang phát: ' + b.textContent.trim());
            } catch (err) {
              setStatus('Lỗi: ' + (err.message || err), true);
            } finally {
              btns.forEach(function(btn) { btn.classList.remove('loading'); });
            }
          });
        });
      })();
      </script>`,
    ].join('\n');

    return {
      state: 'ready',
      type: 'video',
      noCache: true,
      noPrefetch: true,
      html: htmlContent,
    };
  }

  resolveUrl(path: string): string {
    const clean = path.split('?')[0];
    return clean.startsWith('http') ? clean : `${this.site}${clean}`;
  }
}

export default new YanHH3DPlugin();
