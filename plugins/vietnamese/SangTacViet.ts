import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { defaultCover } from '@libs/defaultCover';

const SITE = 'https://sangtacviet.app';

// ── Webfont glyph decode ─────────────────────────────
const GLYPH_MAP: Record<string, string> = {};
([
  [0xE01B,'A'],[0xE01E,'y'],[0xE05F,'3'],[0xE063,'z'],[0xE06B,'K'],[0xE06C,'t'],
  [0xE089,'l'],[0xE0D5,'S'],[0xE0D6,'T'],[0xE100,'o'],[0xE101,'P'],[0xE116,'4'],
  [0xE122,'W'],[0xE124,'Z'],[0xE14B,'J'],[0xE160,'e'],[0xE184,'O'],[0xE186,'D'],
  [0xE1A4,'f'],[0xE1AD,'e'],[0xE1B4,'k'],[0xE1B8,'f'],[0xE1BF,'n'],[0xE1C0,'Y'],
  [0xE1C1,'1'],[0xE1D8,'K'],[0xE1E4,'M'],[0xE1EA,'Y'],[0xE215,'C'],[0xE218,'A'],
  [0xE22B,'h'],[0xE240,'x'],[0xE248,'v'],[0xE257,'G'],[0xE27E,'b'],[0xE2A9,'B'],
  [0xE2C5,'s'],[0xE2C7,'t'],[0xE2CA,'G'],[0xE2E3,'k'],[0xE2F8,'q'],[0xE30F,'F'],
  [0xE311,'u'],[0xE32F,'E'],[0xE334,'2'],[0xE34A,'I'],[0xE37C,'R'],[0xE38F,'v'],
  [0xE39B,'X'],[0xE3B0,'l'],[0xE3B7,'7'],[0xE3F1,'l'],[0xE41B,'o'],[0xE41C,'H'],
  [0xE426,'S'],[0xE427,'J'],[0xE43E,'6'],[0xE44E,'X'],[0xE46A,'b'],[0xE477,'y'],
  [0xE49A,'c'],[0xE4A3,'8'],[0xE4AE,'2'],[0xE4CC,'s'],[0xE4D3,'5'],[0xE4DB,'L'],
  [0xE4DF,'N'],[0xE4EC,'5'],[0xE4F3,'r'],[0xE519,'0'],[0xE51F,'g'],[0xE550,'E'],
  [0xE557,'h'],[0xE566,'N'],[0xE571,'F'],[0xE57B,'O'],[0xE5BD,'C'],[0xE5C1,'d'],
  [0xE5C9,'8'],[0xE5D1,'x'],[0xE5DC,'m'],[0xE5E1,'9'],[0xE5F0,'u'],[0xE5FA,'m'],
  [0xE5FF,'a'],[0xE603,'U'],[0xE62A,'w'],[0xE636,'P'],[0xE63E,'D'],[0xE648,'6'],
  [0xE65B,'H'],[0xE65D,'z'],[0xE660,'9'],[0xE68D,'1'],[0xE691,'M'],[0xE6A4,'q'],
  [0xE6A5,'c'],[0xE6D7,'W'],[0xE6E0,'R'],[0xE6F1,'T'],[0xE6F3,'a'],[0xE6F5,'g'],
  [0xE705,'w'],[0xE71A,'3'],[0xE735,'Z'],[0xE74F,'Q'],[0xE762,'r'],[0xE765,'n'],
  [0xE775,'V'],[0xE77A,'d'],[0xE77D,'L'],[0xE77E,'4'],[0xE7C7,'U'],[0xE7E5,'0'],
  [0xE7F6,'7'],[0xE902,'A'],[0xE915,'O'],[0xE91F,'e'],[0xE946,'a'],[0xE95D,'2'],
  [0xE97B,'f'],[0xE9A8,'y'],[0xE9CC,'P'],[0xE9D5,'o'],[0xE9D7,'r'],[0xE9F8,'O'],
  [0xE9F9,'K'],[0xEA15,'e'],[0xEA20,'Y'],[0xEA24,'N'],[0xEA2D,'v'],[0xEA2E,'R'],
  [0xEA2F,'C'],[0xEA43,'4'],[0xEA47,'l'],[0xEA65,'S'],[0xEA75,'M'],[0xEA76,'H'],
  [0xEA77,'u'],[0xEA82,'o'],[0xEAA1,'k'],[0xEAA4,'a'],[0xEAA5,'x'],[0xEAA6,'z'],
  [0xEAB2,'6'],[0xEAB4,'t'],[0xEABB,'y'],[0xEAC5,'w'],[0xEACF,'b'],[0xEAD5,'L'],
  [0xEAE3,'A'],[0xEAED,'F'],[0xEB02,'s'],[0xEB06,'s'],[0xEB0E,'C'],[0xEB0F,'R'],
  [0xEB18,'w'],[0xEB27,'D'],[0xEB62,'l'],[0xEB63,'9'],[0xEB75,'h'],[0xEB85,'X'],
  [0xEBEC,'k'],[0xEBF6,'N'],[0xEC0F,'q'],[0xEC19,'J'],[0xEC50,'7'],[0xEC6D,'g'],
  [0xEC75,'d'],[0xEC85,'n'],[0xECAD,'V'],[0xECB4,'S'],[0xECD4,'L'],[0xECDB,'Z'],
  [0xECE6,'E'],[0xECF8,'U'],[0xED07,'V'],[0xED2C,'Q'],[0xED35,'l'],[0xED37,'J'],
  [0xED48,'W'],[0xED64,'5'],[0xED71,'2'],[0xED72,'v'],[0xED8C,'E'],[0xEDEB,'Y'],
  [0xEDEC,'5'],[0xEDED,'m'],[0xEE01,'c'],[0xEE09,'Q'],[0xEE0C,'n'],[0xEE0F,'u'],
  [0xEE47,'W'],[0xEE5C,'P'],[0xEE69,'b'],[0xEE8D,'0'],[0xEEA1,'X'],[0xEEBB,'F'],
  [0xEEC1,'I'],[0xEECC,'B'],[0xEECF,'c'],[0xEEDA,'1'],[0xEEDB,'D'],[0xEEE3,'G'],
  [0xEF1F,'8'],[0xEF26,'K'],[0xEF35,'x'],[0xEF37,'6'],[0xEF3A,'d'],[0xEF57,'H'],
  [0xEF5A,'U'],[0xEF61,'G'],[0xEF91,'8'],[0xEF94,'T'],[0xEFC8,'m'],[0xEFD4,'1'],
  [0xEFD7,'Z'],[0xEFDA,'h'],[0xEFEE,'3'],[0xEFEF,'4'],[0xEFF6,'3'],[0xF00A,'q'],
  [0xF019,'T'],[0xF050,'B'],[0xF065,'0'],[0xF073,'7'],[0xF096,'z'],[0xF0A6,'t'],
  [0xF0BA,'r'],[0xF0BD,'M'],[0xF0C0,'g'],[0xF7A0,'0'],[0xF7A1,'1'],[0xF7A2,'2'],
  [0xF7A3,'3'],[0xF7A4,'4'],[0xF7A5,'5'],[0xF7A6,'6'],[0xF7A7,'7'],[0xF7A8,'8'],
  [0xF7A9,'9'],[0xF8FF,'*'],
] as [number, string][]).forEach(([code, ch]) => {
  GLYPH_MAP[String.fromCharCode(code)] = ch;
});

function decodeGlyphs(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    out += GLYPH_MAP[ch] ?? ch;
  }
  return out;
}

// ── Content normalization  ─────────────────
function looksLikeInterlinear(text: string): boolean {
  return /<i\b[^>]*\b(?:t|v|p)\s*=\s*['"][^'"]*['"][^>]*>/i.test(text);
}

function normalizeInterlinear(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  t = t.replace(/<br\s*\/?>\s*/gi, '\n').replace(/<\/br\s*>/gi, '\n');
  t = t.replace(/<\/i>\s*\n+\s*(?=[,.;:!?%\)\]\}\u3002\uff0c\u3001\uff01\uff1f\uff1b\uff1a\u201d\u2019\u300d\u300f\u3011\u300b])/gi, '</i>');
  const marker = '__STV_GAP__';
  t = t.replace(/<\/i>\s*<i\b/gi, '</i>' + marker + '<i');
  t = t.replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, '$1');
  t = t.replace(/<\/?(p|div|article|section|li|tr|h[1-6]|blockquote|ul|ol)[^>]*>/gi, '\n');
  t = t.replace(/<[^>]+>/g, '').replace(/[<>]/g, '');
  t = t.replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
  t = t.replace(new RegExp(marker, 'g'), ' ');
  t = t.replace(/[\t\f\v ]+/g, ' ');
  t = t.replace(/ +([,.;:!?%\)\]\}\u3002\uff0c\u3001\uff01\uff1f\uff1b\uff1a\u201d\u2019\u300d\u300f\u3011\u300b])/g, '$1');
  t = t.replace(/\n+([,.;:!?%\)\]\}\u3002\uff0c\u3001\uff01\uff1f\uff1b\uff1a\u201d\u2019\u300d\u300f\u3011\u300b])/g, '$1');
  t = t.replace(/[ ]*\n[ ]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t ? t.replace(/\n/g, '<br>') : '';
}

function normalizeChapterHtml(host: string, raw: string): string {
  let text = raw || '';
  if (!text) return '';
  const h = host.toLowerCase();

  if (h === 'fanqie') {
    text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
    text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
    text = text.replace(/<\/?article>/gi, '');
    text = text.replace(/\sidx="\d+"/g, '');
    if (looksLikeInterlinear(text)) return normalizeInterlinear(text);
    return text;
  }

  if (h === 'sangtac' || h === 'dich') {
    text = decodeGlyphs(text);
    if (looksLikeInterlinear(text)) return normalizeInterlinear(text);
    if (!/<\w+[^>]*>/.test(text)) {
      text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');
    }
    return text;
  }

  if (!/<\w+[^>]*>/.test(text)) {
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');
    return text;
  }
  if (looksLikeInterlinear(text)) return normalizeInterlinear(text);
  return text;
}

class SangTacVietPlugin implements Plugin.PluginBase {
  id = 'sangtacviet';
  name = 'Sáng Tác Việt';
  icon = 'src/vi/sangtacviet/icon.png';
  site = SITE;
  version = '1.0.0';
  webStorageUtilized = true;

  parseNovelsFromHTML(html: string): Plugin.NovelItem[] {
    const novels: Plugin.NovelItem[] = [];
    const $ = parseHTML(html);
    $('a.booksearch').each((_, el) => {
      const href = $(el).attr('href') || '';
      const name = $(el).find('.searchbooktitle').text().trim();
      const cover =
        $(el).find('img').attr('src') ||
        defaultCover;
      if (href && name) {
        novels.push({ name, cover, path: href });
      }
    });
    return novels;
  }

  async popularNovels(
    pageNo: number,
    options: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const { filters } = options;
    let sort = options.showLatestNovels ? 'update' : 'view';
    let minc = '0';
    let category = '';
    let type = '';
    let step = '';
    let host = '';
    let tag = '';

    if (filters) {
      if (filters.sort?.value) sort = filters.sort.value;
      minc = filters.minc?.value || '0';
      category = filters.category?.value || '';
      type = filters.type?.value || '';
      step = filters.step?.value || '';
      host = filters.host?.value || '';
      tag = filters.tag?.value?.join(',') || '';
    }

    let url = `${SITE}/io/searchtp/searchBooks?find=&minc=${minc}&sort=${sort}&tag=${tag}`;
    if (category) url += `&category=${category}`;
    if (type) url += `&type=${type}`;
    if (step) url += `&step=${step}`;
    if (host) url += `&host=${host}`;
    url += `&p=${pageNo}`;

    const res = await fetchApi(url);
    const html = await res.text();
    return this.parseNovelsFromHTML(html);
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    // Extract host and bookid from path: /truyen/{host}/{sty}/{bookid}/
    const pathParts = novelPath.replace(/^\/|\/$/g, '').split('/');
    const bookHost = pathParts[1] || '';
    const bookId = pathParts[3] || '';

    const headers = {
      'x-stv-transport': 'app',
      'x-requested-with': 'com.sangtacviet.mobilereader',
      Referer: `${SITE}/truyen/${bookHost}/1/${bookId}/`,
    };

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: 'Không có tiêu đề',
    };

    // Step 1: Fetch novel info via JSON API
    if (bookHost && bookId) {
      const infoUrl =
        `${SITE}/mobile/bookinfo.php?host=${encodeURIComponent(bookHost)}` +
        `&hid=${encodeURIComponent(bookId)}`;
      const infoRes = await fetchApi(infoUrl, { headers });
      const infoJson = await infoRes.json();

      if (infoJson.code === 100 && infoJson.book) {
        const book = infoJson.book;
        novel.name = (book.tname || book.name || 'Không có tiêu đề').trim();
        novel.author = (book.hauthor || book.author || '').trim();
        novel.summary = (book.info || '')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .replace(/\t/g, '\n')
          .trim();
        novel.genres = (book.category || '').trim();
        novel.cover = book.thumb
          ? book.thumb.startsWith('http')
            ? book.thumb
            : `${SITE}${book.thumb}`
          : defaultCover;

        const st = String(book.status || '').trim().toLowerCase();
        if (st === '0' || st === 'hoàn thành')
          novel.status = NovelStatus.Completed;
        else if (st === '1' || st === 'còn tiếp')
          novel.status = NovelStatus.Ongoing;
        else if (st === '2' || st === 'tạm ngưng')
          novel.status = NovelStatus.OnHiatus;
        else novel.status = NovelStatus.Unknown;
      } else {
        // Fallback to HTML scraping if JSON API fails
        const res = await fetchApi(SITE + novelPath, { headers });
        const html = await res.text();
        const $ = parseHTML(html);
        novel.name =
          $('meta[property="og:novel:book_name"]').attr('content') ||
          $('#book_name2').text().trim() ||
          'Không có tiêu đề';
        novel.cover =
          $('meta[property="og:image"]').attr('content') || defaultCover;
        novel.author =
          $('meta[property="og:novel:author"]').attr('content') ||
          $('h2').first().text().trim();
        novel.summary = (
          $('meta[property="og:description"]').attr('content') ||
          $('.textzoom').text().trim()
        ).replace(/\\n/g, '\n');
        novel.genres = (
          $('meta[property="og:novel:category"]').attr('content') || ''
        ).trim();
        const statusText = (
          $('meta[property="og:novel:status"]').attr('content') || ''
        ).trim();
        if (statusText === 'Hoàn thành') novel.status = NovelStatus.Completed;
        else if (statusText === 'Còn tiếp') novel.status = NovelStatus.Ongoing;
        else if (statusText === 'Tạm ngưng')
          novel.status = NovelStatus.OnHiatus;
        else novel.status = NovelStatus.Unknown;
      }
    }

    // Step 2: Fetch chapter list
    if (bookHost && bookId) {
      const chapUrl =
        `${SITE}/index.php?ngmar=chapterlist` +
        `&h=${encodeURIComponent(bookHost)}` +
        `&bookid=${encodeURIComponent(bookId)}` +
        `&sajax=getchapterlist`;
      const chapRes = await fetchApi(chapUrl, { headers });
      const chapJson = await chapRes.json();
      if (chapJson.code === 1 && chapJson.data) {
        const chapters: Plugin.ChapterItem[] = [];
        const seen: Record<string, boolean> = {};
        const rows = (chapJson.data as string).split('-//-');
        let chapterNum = 0;
        rows.forEach(row => {
          const trimmed = row.trim();
          if (!trimmed) return;
          const cols = trimmed.split('-/-');
          if (cols.length < 3) return;
          const chapId = cols[1].trim();
          const chapName = cols[2].trim();
          if (!chapId || !chapName) return;
          const dedup = chapId + '|' + chapName;
          if (seen[dedup]) return;
          seen[dedup] = true;
          chapterNum++;
          const vipFlag = (cols.length >= 4 ? cols[3] : '').trim().toLowerCase();
          const isVip = vipFlag === 'vip';
          const isUnlocked = vipFlag === 'unvip';
          chapters.push({
            name: isVip && !isUnlocked ? '[VIP] ' + chapName : chapName,
            path: `/truyen/${bookHost}/1/${bookId}/${chapId}/`,
            chapterNumber: chapterNum,
          });
        });
        novel.chapters = chapters;
      }
    }

    return novel;
  }

  extractCookiesFromHtml(html: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    // Inline JS the page ships looks like: document.cookie = "_ac=...; path=/";
    const re = /document\.cookie\s*=\s*["']([^"';]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const idx = m[1].indexOf('=');
      if (idx <= 0) continue;
      const key = m[1].substring(0, idx).trim();
      const value = m[1].substring(idx + 1).trim();
      if (key && value) cookies[key] = value;
    }
    return cookies;
  }

  parseLooseJson(text: string): {
    code?: string | number;
    data?: string;
    chaptername?: string;
    bookhost?: string;
  } | null {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      const idx = text.indexOf('{');
      if (idx < 0) return null;
      try {
        return JSON.parse(text.substring(idx));
      } catch {
        return null;
      }
    }
  }

  // Apply Set-Cookie response header into our local cookie jar.
  applySetCookie(cookies: Record<string, string>, setCookie: string): void {
    if (!setCookie) return;
    // The server uses comma-separated header sometimes; split conservatively
    // by `;` first and pick `key=value` tokens that look like cookie pairs.
    // For now, rely on the well-known names that the server actually rotates.
    const names = ['_ac', '_acx', '_gac', 'PHPSESSID', 'arouting'];
    for (const name of names) {
      const re = new RegExp(name + '=([^;\\s,]+)', 'i');
      const m = setCookie.match(re);
      if (m && m[1]) cookies[name] = m[1];
    }
  }

  buildCookieHeader(cookies: Record<string, string>): string {
    return Object.keys(cookies)
      .filter(k => cookies[k])
      .map(k => `${k}=${cookies[k]}`)
      .join('; ');
  }

  async parseChapter(chapterPath: string): Promise<string> {
    // Path: /truyen/{host}/{sty}/{bookid}/{chapterId}/
    const pathParts = chapterPath.replace(/^\/|\/$/g, '').split('/');
    const bookHost = pathParts[1] || '';
    const bookId = pathParts[3] || '';
    const chapterId = pathParts[4] || '';
    const referer = `${SITE}${chapterPath}`;

    const cookies: Record<string, string> = {};

    // Step 1: prime the session
    try {
      const pageRes = await fetchApi(referer);
      const html = await pageRes.text();
      Object.assign(cookies, this.extractCookiesFromHtml(html));
      this.applySetCookie(cookies, pageRes.headers.get('set-cookie') || '');
    } catch {
      // continue — server may still recognise the WebView's cookie jar
    }

    const apiUrl =
      `${SITE}/index.php?bookid=${encodeURIComponent(bookId)}` +
      `&h=${encodeURIComponent(bookHost)}` +
      `&c=${encodeURIComponent(chapterId)}` +
      `&ngmar=readc&sajax=readchapter&sty=1&exts=`;

    // Step 2: probe POST that rotates `_ac`. We don't care about the body
    try {
      const probeHeaders: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XmlHttpRequest',
        Referer: referer,
      };
      const probeCookie = this.buildCookieHeader(cookies);
      if (probeCookie) probeHeaders.Cookie = probeCookie;
      const probeRes = await fetchApi(apiUrl, {
        method: 'POST',
        headers: probeHeaders,
        body: '',
      });
      // Drain the response so the underlying fetch implementation doesn't
      // hold the connection open, but we don't actually need the JSON.
      await probeRes.text();
      this.applySetCookie(cookies, probeRes.headers.get('set-cookie') || '');
    } catch {
      // probe is best-effort; carry on
    }

    // Step 3: actual chapter fetch using the rotated cookies.
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: referer,
      };
      const cookieHeader = this.buildCookieHeader(cookies);
      if (cookieHeader) headers.Cookie = cookieHeader;
      const chapRes = await fetchApi(apiUrl, {
        method: 'POST',
        headers,
        body: '',
      });
      const data = this.parseLooseJson(await chapRes.text());
      if (data && String(data.code) === '0' && data.data) {
        const host = data.bookhost || bookHost;
        const content = normalizeChapterHtml(host, data.data);
        const title = data.chaptername?.trim();
        return (title ? `<h2>${title}</h2>` : '') + content;
      }
    } catch {
      // fall through
    }

    return '';
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const url = `${SITE}/io/searchtp/searchBooks?find=${encodeURIComponent(searchTerm)}&minc=0&sort=&tag=&p=${pageNo}`;
    const res = await fetchApi(url);
    const html = await res.text();
    return this.parseNovelsFromHTML(html);
  }

  resolveUrl(path: string, isNovel?: boolean): string {
    return SITE + path;
  }

  filters = {
    sort: {
      type: FilterTypes.Picker,
      label: 'Sắp xếp',
      value: 'view',
      options: [
        { label: 'Không sắp xếp', value: '' },
        { label: 'Mới nhập kho', value: 'new' },
        { label: 'Mới cập nhật', value: 'update' },
        { label: 'Lượt đọc tổng', value: 'view' },
        { label: 'Lượt đọc tuần', value: 'viewweek' },
        { label: 'Lượt đọc ngày', value: 'viewday' },
        { label: 'Lượt thích', value: 'like' },
        { label: 'Lượt theo dõi', value: 'following' },
        { label: 'Lượt đánh dấu', value: 'bookmarked' },
        { label: 'Đề cử', value: 'auto' },
      ],
    },
    minc: {
      type: FilterTypes.Picker,
      label: 'Số chương tối thiểu',
      value: '0',
      options: [
        { label: 'Tất cả', value: '0' },
        { label: '> 50', value: '50' },
        { label: '> 100', value: '100' },
        { label: '> 200', value: '200' },
        { label: '> 500', value: '500' },
        { label: '> 1000', value: '1000' },
        { label: '> 1500', value: '1500' },
        { label: '> 2000', value: '2000' },
      ],
    },
    category: {
      type: FilterTypes.Picker,
      label: 'Thể loại chính',
      value: '',
      options: [
        { label: 'Tất cả', value: '' },
        { label: 'Huyền huyễn', value: 'hh' },
        { label: 'Đô thị', value: 'dt' },
        { label: 'Ngôn tình', value: 'nt' },
        { label: 'Võng du', value: 'vd' },
        { label: 'Khoa học viễn tưởng', value: 'kh' },
        { label: 'Lịch sử', value: 'ls' },
        { label: 'Đồng nhân', value: 'dn' },
        { label: 'Dị năng', value: 'dna' },
        { label: 'Linh dị', value: 'ld' },
        { label: 'Light Novel', value: 'ln' },
      ],
    },
    type: {
      type: FilterTypes.Picker,
      label: 'Loại truyện',
      value: '',
      options: [
        { label: 'Tất cả', value: '' },
        { label: 'Truyện sáng tác', value: 'sangtac' },
        { label: 'Truyện dịch', value: 'dich' },
        { label: 'Truyện tranh', value: 'comic' },
        { label: 'Txt dịch tự động', value: 'txt' },
        { label: 'Truyện scan ảnh', value: 'scan' },
      ],
    },
    step: {
      type: FilterTypes.Picker,
      label: 'Trạng thái đăng',
      value: '',
      options: [
        { label: 'Tất cả', value: '' },
        { label: 'Hoàn thành', value: '3' },
        { label: 'Còn tiếp', value: '1' },
        { label: 'Tạm ngưng', value: '2' },
        { label: 'Không tạm ngưng', value: '5' },
      ],
    },
    host: {
      type: FilterTypes.Picker,
      label: 'Nguồn truyện',
      value: '',
      options: [
        { label: 'Tất cả', value: '' },
        { label: '[Vip] fanqie (Cà Chua)', value: 'fanqie' },
        { label: '[Vip] qidian (Khởi Điểm)', value: 'qidian' },
        { label: '[Vip] ciweimao', value: 'ciweimao' },
        { label: '[Vip] faloo (Phi Lư)', value: 'faloo' },
        { label: '[Vip] jjwxc (Tấn Giang)', value: 'jjwxc' },
        { label: '[Vip] sfacg', value: 'sfacg' },
        { label: '[Vip] zongheng (Tung Hoành)', value: 'zongheng' },
        { label: '[Free] 69shu', value: '69shu' },
        { label: '[Free] tadu', value: 'tadu' },
        { label: '[Free] qimao (7 Mèo)', value: 'qimao' },
        { label: '[Free] idejian', value: 'idejian' },
        { label: '[LN] linovel', value: 'linovel' },
        { label: '[LN] wenku8', value: 'wenku8' },
      ],
    },
    tag: {
      type: FilterTypes.CheckboxGroup,
      label: 'Nhãn',
      value: [],
      options: [
        { label: 'Đô Thị', value: 'dothi' },
        { label: 'Xuyên Qua', value: 'xuyenqua' },
        { label: 'Hệ Thống', value: 'hethong' },
        { label: 'Huyền Huyễn', value: 'huyenhuyen' },
        { label: 'Ngôn Tình', value: 'ngontinh' },
        { label: 'Đồng Nhân', value: 'dongnhan' },
        { label: 'Trùng Sinh', value: 'trungsinh' },
        { label: 'Lịch Sử', value: 'lichsu' },
        { label: 'Khoa Huyễn', value: 'khoahuyen' },
        { label: 'Tiên Hiệp', value: 'tienhiep' },
        { label: 'Võ Hiệp', value: 'vohiep' },
        { label: 'Sảng Văn', value: 'sangvan' },
        { label: 'Light Novel', value: 'lightnovel' },
        { label: 'Linh Dị', value: 'linhdi' },
        { label: 'Kỳ Huyễn', value: 'kyhuyen' },
        { label: 'Tận Thế', value: 'tanthe' },
        { label: 'Ngọt Sủng', value: 'ngotsung' },
        { label: 'Sân Trường', value: 'santruong' },
        { label: 'Nhiệt Huyết', value: 'nhiethuyet' },
        { label: 'Nhanh Xuyên', value: 'nhanhxuyen' },
      ],
    },
  } satisfies Filters;
}

export default new SangTacVietPlugin();