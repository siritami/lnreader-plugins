import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { defaultCover } from '@libs/defaultCover';
import { storage } from '@libs/storage';
import { cbc } from '@libs/aes';

const SITE = 'https://tomatomtl.com';
const CHAPTERS_PER_VOLUME = 50;

// ─── Translation language options shown to users.
// Mirrors the "Select Translation Language" dropdown on /settings.
const TRANSLATE_LANG_OPTIONS = [
  { label: 'Tiếng Việt', value: 'vi' },
  { label: 'English', value: 'en' },
];

// Translation providers shown next to the in-page "Translate" button.
// Mirrors the four built-in options on tomatomtl.com's /translate page,
// plus an LLM-based option that uses the LongCat-Flash-Chat API
// (https://longcat.chat/platform – 500K free tokens/day).
const TRANSLATE_PROVIDER_OPTIONS = [
  { label: 'Không dịch (Tiếng Trung gốc)', value: 'none' },
  { label: 'Google (translateHtml)', value: 'google' },
  { label: 'Google 2 (sentence API)', value: 'google2' },
  { label: 'Bing', value: 'bing' },
  { label: 'Yandex', value: 'yandex' },
  { label: 'TomatoMTL Gemini (server proxy, free)', value: 'tomato_gemini' },
  { label: 'LongCat (LLM, dùng pool key của site)', value: 'longcat' },
];

// Human-readable target language names used when prompting the LLM.
const LANG_NAMES: Record<string, string> = {
  vi: 'Vietnamese (Tiếng Việt)',
  en: 'English',
};

// ─── Categories scraped from /fanqie-explorer (subset of the most useful ones).
// The site provides hundreds of niche tags grouped by Theme/Roles/Plot, but
// the "category_id" filter accepts any of them as a single ID.
const CATEGORY_OPTIONS = [
  { label: 'Tất cả', value: '-1' },
  { label: 'Đô thị', value: '1' },
  { label: 'Ngôn tình hiện đại', value: '3' },
  { label: 'Ngôn tình cổ đại', value: '5' },
  { label: 'Huyền huyễn', value: '7' },
  { label: 'Trinh thám / Suy luận', value: '10' },
  { label: 'Lịch sử', value: '12' },
  { label: 'Thể thao', value: '15' },
  { label: 'Võ hiệp', value: '16' },
  { label: 'Ngôn tình huyền ảo', value: '32' },
  { label: 'Kỳ ảo / Tiên hiệp', value: '259' },
  { label: 'Trường học', value: '4' },
  { label: 'Khoa huyễn / Mạt thế', value: '8' },
  { label: 'Đồng quê', value: '11' },
  { label: 'Hệ thống', value: '19' },
  { label: 'Thần hào', value: '20' },
  { label: 'Điền văn', value: '23' },
  { label: 'Khoái xuyên (Quick Transmigration)', value: '24' },
  { label: 'Trùng sinh', value: '36' },
  { label: 'Xuyên việt', value: '37' },
  { label: '2D / Anime', value: '39' },
  { label: 'Trọng sinh xuyên thư', value: '102' },
  { label: 'Đô thị võ thuật', value: '1014' },
  { label: 'Bại tế (Live-in son-in-law)', value: '25' },
  { label: 'Thần y', value: '26' },
  { label: 'Tổng tài', value: '29' },
];

type EncryptedPayload = {
  iv: string;
  enc: string;
};

class TomatoMTLPlugin implements Plugin.PluginBase {
  id = 'tomatomtl';
  name = 'TomatoMTL';
  icon = 'src/vi/tomatomtl/icon.png';
  site = SITE;
  version = '1.0.0';
  webStorageUtilized = true;

  pluginSettings: Plugin.PluginSettings = {
    translateLanguage: {
      type: 'Select',
      label: 'Ngôn ngữ dịch (Select Translation Language)',
      value: 'vi',
      options: TRANSLATE_LANG_OPTIONS,
    },
    translateProvider: {
      type: 'Select',
      label: 'Công cụ dịch chương (Translate provider)',
      value: 'google',
      options: TRANSLATE_PROVIDER_OPTIONS,
    },
    showOriginal: {
      type: 'Switch',
      label: 'Hiển thị bản gốc Tiếng Trung kèm theo',
      value: false,
    },
    longcatApiKey: {
      type: 'Text',
      label:
        'LongCat API Key (TÙY CHỌN - để trống sẽ dùng pool key của tomatomtl.com)',
      value: '',
    },
    longcatModel: {
      type: 'Text',
      label: 'LongCat model (mặc định: LongCat-Flash-Chat)',
      value: 'LongCat-Flash-Chat',
    },
  };

  // ─── Setting accessors ──────────────────────────────
  get translateLanguage(): string {
    return (storage.get('translateLanguage') as string) || 'vi';
  }
  get translateProvider(): string {
    return (storage.get('translateProvider') as string) || 'google';
  }
  get showOriginal(): boolean {
    return Boolean(storage.get('showOriginal'));
  }
  get longcatApiKey(): string {
    return (storage.get('longcatApiKey') as string) || '';
  }
  get longcatModel(): string {
    return (
      (storage.get('longcatModel') as string) || 'LongCat-Flash-Chat'
    );
  }

  // ─── Cookie / session management ───────────────────────────
  // Local cookie jar that mirrors Set-Cookie responses we observe so
  // requests within a single session can reuse the same PHPSESSID etc.
  // Login itself is handled by the user inside LNReader's WebView; the
  // session cookies they set there are picked up automatically by
  // LNReader's `fetchApi` because `webStorageUtilized = true` is set.
  private cookieJar: Record<string, string> = {};
  // Yandex widget sid is required for the public translate API and
  // is rotated by Yandex; cache it for ~1h like the site does.
  private yandexSidCache: { sid: string; t: number } | null = null;
  // Cached body of /assets/longcat1.txt – the encrypted pool of LongCat
  // API keys that the site uses for its built-in "LLM LongCat" provider.
  // Refreshed every hour so newly added keys are picked up automatically.
  private siteLongcatFileCache: { text: string; t: number } | null = null;

  private buildCookieHeader(extra?: Record<string, string>): string {
    const merged: Record<string, string> = {
      ...this.cookieJar,
      // Mirror the site preferences chosen in plugin settings so
      // the server renders chapters with the right translation hints.
      translator_button: this.translateLanguage,
      // Site cookie accepts: google | google2 | bing | yandex.
      machine_translation:
        this.translateProvider === 'none'
          ? 'google'
          : this.translateProvider,
      ...(extra || {}),
    };
    return Object.entries(merged)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  private absorbSetCookie(header: string | null | undefined): void {
    if (!header) return;
    // Multiple Set-Cookie headers may be comma-joined; split safely on
    // boundaries that look like a new cookie (name=value preceded by comma).
    const parts = header.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
    for (const raw of parts) {
      const seg = raw.split(';')[0].trim();
      if (!seg) continue;
      const eq = seg.indexOf('=');
      if (eq <= 0) continue;
      const name = seg.substring(0, eq).trim();
      const value = seg.substring(eq + 1).trim();
      if (
        !name ||
        value === '' ||
        value === 'deleted' ||
        /max-age=0/i.test(raw)
      ) {
        delete this.cookieJar[name];
      } else {
        this.cookieJar[name] = value;
      }
    }
  }

  private async fetchHtml(
    url: string,
    init: {
      method?: string;
      body?: string | FormData;
      headers?: Record<string, string>;
    } = {},
  ): Promise<{ html: string; status: number }> {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 10; LNReader) AppleWebKit/537.36',
      Referer: SITE + '/',
      ...(init.headers || {}),
    };
    const cookieHeader = this.buildCookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    const res = await fetchApi(url, { ...init, headers });
    this.absorbSetCookie(res.headers.get('set-cookie'));
    const html = await res.text();
    return { html, status: res.status };
  }

  // Login is handled exclusively in LNReader's WebView (the site uses
  // Cloudflare Turnstile, so programmatic POST always fails). Anything
  // here is just a best-effort warm-up of the session in case the user
  // is already logged in.
  private async warmUpSession(): Promise<void> {
    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 10; LNReader) AppleWebKit/537.36',
        Referer: `${SITE}/`,
      };
      const cookieHeader = this.buildCookieHeader();
      if (cookieHeader) headers.Cookie = cookieHeader;
      const res = await fetchApi(`${SITE}/user/login`, {
        method: 'GET',
        headers,
      });
      this.absorbSetCookie(res.headers.get('set-cookie'));
      // Drain the body so the underlying connection is released.
      await res.text();
    } catch {
      // Best-effort – the user can still log in via the WebView later.
    }
  }

  // ─── AES-128-CBC decryption matching the site's chapter_decrypt() ─────
  private decryptPayload(unlockCode: string, payload: EncryptedPayload): string {
    const keyBytes = base64ToBytes(unlockCode).subarray(0, 16);
    const ivBytes = base64ToBytes(payload.iv);
    const encBytes = base64ToBytes(payload.enc);
    const decrypted = cbc(keyBytes, ivBytes).decrypt(encBytes);
    return bytesToUtf8(decrypted);
  }

  private extractInlineString(html: string, name: string): string {
    const re = new RegExp(name + '\\s*=\\s*"([^"]+)"');
    const m = re.exec(html);
    return m ? m[1] : '';
  }

  private extractEncryptedData(html: string): EncryptedPayload | null {
    const m = /encryptedData\s*=\s*(\{[\s\S]*?\})\s*;/.exec(html);
    if (!m) return null;
    try {
      return JSON.parse(m[1]) as EncryptedPayload;
    } catch {
      return null;
    }
  }

  // ─── Translation helpers ───────────────────────────────────
  private async translateGoogle(
    lines: string[],
    target: string,
  ): Promise<string[]> {
    if (!lines.length) return [];
    // The same endpoint the site uses for Google translation (no auth,
    // returns translations array aligned with input lines).
    const body = JSON.stringify([[lines, 'zh-CN', target], 'te']);
    const res = await fetchApi(
      'https://translate-pa.googleapis.com/v1/translateHtml',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json+protobuf',
          'x-goog-api-key': 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520',
          'x-client-data': 'CIH/ygE=',
        },
        body,
      },
    );
    const data = (await res.json()) as unknown;
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return (data[0] as unknown[]).map(l =>
        decodeHtmlEntities(String(l ?? '')),
      );
    }
    return lines;
  }

  // Alternate Google endpoint (site's "google2"). Uses GET with a
  // single concatenated query joined by blank lines so the response's
  // `translation` field can be split back into per-line output.
  // Falls back to the source lines if alignment cannot be recovered.
  private async translateGoogle2(
    lines: string[],
    target: string,
  ): Promise<string[]> {
    if (!lines.length) return [];
    const text = lines.join('\n\n');
    const params = new URLSearchParams({
      'params.client': 'gtx',
      'query.source_language': 'zh-CN',
      'query.target_language': target,
      'query.display_language': target === 'en' ? 'en-US' : target,
      data_types: 'TRANSLATION',
      key: 'AIzaSyDLEeFI5OtFBwYBIoK_jj5m32rZK5CkCXA',
      'query.text': text,
    });
    const res = await fetchApi(
      `https://translate-pa.googleapis.com/v1/translate?${params.toString()}`,
      {
        headers: {
          Accept: '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
    );
    const data = (await res.json()) as { translation?: string };
    const translation = typeof data?.translation === 'string'
      ? data.translation
      : '';
    if (!translation) return lines;
    const out = translation.split('\n\n').map(s => decodeHtmlEntities(s));
    return out.length === lines.length ? out : lines;
  }

  // Yandex public widget API. Requires a short-lived `sid` extracted from
  // the embeddable widget script.
  private async translateYandex(
    lines: string[],
    target: string,
  ): Promise<string[]> {
    if (!lines.length) return [];
    let sid = '';
    if (
      this.yandexSidCache &&
      Date.now() - this.yandexSidCache.t < 3600_000
    ) {
      sid = this.yandexSidCache.sid;
    } else {
      const widget = await fetchApi(
        'https://translate.yandex.net/website-widget/v1/widget.js?widgetId=ytWidget&pageLang=en&widgetTheme=light&autoMode=false',
      );
      const widgetText = await widget.text();
      const m = widgetText.match(/sid:\s*'([^']+)'/);
      if (!m) return lines;
      sid = m[1];
      this.yandexSidCache = { sid, t: Date.now() };
    }

    const idParam = `${encodeURIComponent(sid)}-0-0`;
    const langParam = encodeURIComponent(`zh-${target}`);
    const textParams = lines
      .map(t => `&text=${encodeURIComponent(t)}`)
      .join('');
    const url =
      'https://translate.yandex.net/api/v1/tr.json/translate' +
      `?id=${idParam}&srv=tr-url-widget${textParams}&lang=${langParam}&format=html`;
    const res = await fetchApi(url);
    const data = (await res.json()) as { text?: string[] };
    if (Array.isArray(data?.text) && data.text.length === lines.length) {
      return data.text.map(t => decodeHtmlEntities(String(t ?? '')));
    }
    return lines;
  }

  // tomatomtl.com's own `/gemini` proxy endpoint. The site forwards the
  // prompt to a server-side LLM (DuckDuckGo Gemini wrapper, judging by
  // the `callDuck` helper name in tomato.js) and returns plain text.
  // Pros: no API key, no geo-blocking, uses the same session cookies.
  // Cons: rate-limited per site policy.
  private async translateTomatoGemini(
    lines: string[],
    target: string,
  ): Promise<string[]> {
    if (!lines.length) return [];
    const langName = LANG_NAMES[target] || target;
    const numbered = lines
      .map((line, i) => `${i + 1}. ${line.replace(/\s+/g, ' ').trim()}`)
      .join('\n');
    const prompt =
      `Translate every numbered line below from Simplified Chinese into ${langName}.\n` +
      'Output rules:\n' +
      '- Output one translated line per input line, in the same order.\n' +
      '- Keep the exact "<number>. " prefix at the start of every line.\n' +
      '- Do NOT merge or split lines, do NOT add commentary, headings, or markdown.\n' +
      '\n' +
      numbered;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Referer: `${SITE}/translate`,
      Origin: SITE,
    };
    const cookieHeader = this.buildCookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    const res = await fetchApi(`${SITE}/gemini`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt }),
    });
    this.absorbSetCookie(res.headers.get('set-cookie'));
    if (!res.ok) {
      throw new Error(
        `TomatoMTL /gemini ${res.status} ${res.statusText}`,
      );
    }
    const data = (await res.json()) as {
      response?: string;
      error?: string;
    };
    if (data?.error) {
      throw new Error(`TomatoMTL /gemini error: ${data.error}`);
    }
    const content = typeof data?.response === 'string' ? data.response : '';
    if (!content.trim()) return lines;

    // Map "<n>. text" lines back to their original index, exactly like
    // translateLongcat. Keep source on rows the model failed to emit.
    const out: string[] = lines.slice();
    let parsed = 0;
    for (const raw of content.split(/\r?\n/)) {
      const m = raw.match(/^\s*(\d+)\.\s?(.*)$/);
      if (!m) continue;
      const idx = parseInt(m[1], 10) - 1;
      if (idx < 0 || idx >= out.length) continue;
      out[idx] = m[2].trim() || lines[idx];
      parsed++;
    }
    return parsed >= Math.ceil(lines.length / 2) ? out : lines;
  }

  // Pull a single random LongCat API key from the site's published pool.
  // tomatomtl.com hosts an AES-256-CBC encrypted file (`/assets/longcat1.txt`)
  // containing thousands of `<ivHex>:<cipherB64>` lines. The shared secret
  // `tomato_llm_2024_key` is hashed with SHA-256 to derive the AES key
  // (this matches the site's `loadLLMApiKeys` helper exactly). We refresh
  // the file at most once per hour and decrypt only one random line per
  // call to keep the work proportional to actual chapter requests.
  private async getSiteLongcatKey(): Promise<string> {
    if (
      !this.siteLongcatFileCache ||
      Date.now() - this.siteLongcatFileCache.t > 3600_000
    ) {
      const res = await fetchApi(`${SITE}/assets/longcat1.txt`);
      if (!res.ok) {
        throw new Error(
          `Không tải được pool LongCat key từ ${SITE}/assets/longcat1.txt (HTTP ${res.status}).`,
        );
      }
      this.siteLongcatFileCache = {
        text: await res.text(),
        t: Date.now(),
      };
    }
    const lines = this.siteLongcatFileCache.text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.includes(':'));
    if (!lines.length) {
      throw new Error('Pool LongCat key trống (longcat1.txt không có dòng hợp lệ).');
    }
    const line = lines[Math.floor(Math.random() * lines.length)];
    const [ivHex, cipherB64] = line.split(':');
    const aesKey = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode('tomato_llm_2024_key'),
      ),
    );
    const ivBytes = ivHex.match(/.{2}/g);
    if (!ivBytes || ivBytes.length !== 16) {
      throw new Error('IV không hợp lệ trong longcat1.txt.');
    }
    const iv = new Uint8Array(ivBytes.map(h => parseInt(h, 16)));
    const cipherBytes = Uint8Array.from(atob(cipherB64), c =>
      c.charCodeAt(0),
    );
    const decrypted = cbc(aesKey, iv).decrypt(cipherBytes);
    return new TextDecoder().decode(decrypted).trim();
  }

  // LongCat-Flash-Chat (LLM) translation. Uses the OpenAI-compatible
  // endpoint on api.longcat.chat. If the user has set their own API key
  // in plugin settings we use it; otherwise we transparently borrow one
  // from the site's shared rotating pool (same mechanism powering the
  // "LLM LongCat" option on tomatomtl.com itself).
  private async translateLongcat(
    lines: string[],
    target: string,
  ): Promise<string[]> {
    if (!lines.length) return [];
    const userKey = this.longcatApiKey.trim();
    let apiKey: string;
    if (userKey) {
      apiKey = userKey;
    } else {
      try {
        apiKey = await this.getSiteLongcatKey();
      } catch (err) {
        throw new Error(
          `Không lấy được LongCat API key (cả của bạn lẫn của site đều thất bại): ${(err as Error).message}`,
        );
      }
    }
    const langName = LANG_NAMES[target] || target;
    const numbered = lines
      .map((line, i) => `${i + 1}. ${line.replace(/\s+/g, ' ').trim()}`)
      .join('\n');
    const system =
      `You are a professional Chinese-to-${langName} literary translator.\n` +
      'Translate every numbered line from Simplified Chinese into ' +
      `${langName}, preserving tone, character names, and pronouns.\n` +
      'Output rules:\n' +
      '- Output one translated line per input line, in the same order.\n' +
      '- Keep the exact "<number>. " prefix at the start of every line.\n' +
      '- Do NOT merge or split lines, do NOT add commentary, headings, or markdown.\n' +
      '- If a line is already in the target language, repeat it as-is.';
    const res = await fetchApi(
      'https://api.longcat.chat/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.longcatModel || 'LongCat-Flash-Chat',
          stream: false,
          temperature: 0.2,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: numbered },
          ],
        }),
      },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(
        `LongCat API ${res.status}: ${errText.slice(0, 200) || res.statusText}`,
      );
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) return lines;

    // Map "<n>. text" lines back to their original index.
    const out: string[] = lines.slice();
    let parsed = 0;
    for (const raw of content.split(/\r?\n/)) {
      const m = raw.match(/^\s*(\d+)\.\s?(.*)$/);
      if (!m) continue;
      const idx = parseInt(m[1], 10) - 1;
      if (idx < 0 || idx >= out.length) continue;
      out[idx] = m[2].trim() || lines[idx];
      parsed++;
    }
    return parsed >= Math.ceil(lines.length / 2) ? out : lines;
  }

  private async translateBing(
    lines: string[],
    target: string,
  ): Promise<string[]> {
    if (!lines.length) return [];
    const tokenRes = await fetchApi(
      'https://edge.microsoft.com/translate/auth',
    );
    const token = (await tokenRes.text()).trim();
    if (!token) return lines;

    const url =
      'https://api.cognitive.microsofttranslator.com/translate' +
      `?from=&to=${encodeURIComponent(target)}` +
      '&api-version=3.0&textType=html&includeSentenceLength=true';

    const res = await fetchApi(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(lines.map(t => ({ Text: t }))),
    });
    const data = (await res.json()) as {
      translations?: { text?: string }[];
    }[];
    if (Array.isArray(data)) {
      return data.map(item => {
        const tr = item?.translations?.[0]?.text;
        return typeof tr === 'string' ? tr : '';
      });
    }
    return lines;
  }

  private async translateChunked(
    lines: string[],
    target: string,
  ): Promise<string[]> {
    // Chunk to keep request body reasonable (~5KB per call).
    const chunks: string[][] = [];
    let current: string[] = [];
    let charCount = 0;
    for (const line of lines) {
      if (charCount + line.length > 4500 && current.length) {
        chunks.push(current);
        current = [];
        charCount = 0;
      }
      current.push(line);
      charCount += line.length;
    }
    if (current.length) chunks.push(current);

    const provider = this.translateProvider;
    const results: string[][] = [];
    for (const chunk of chunks) {
      try {
        let out: string[];
        switch (provider) {
          case 'bing':
            out = await this.translateBing(chunk, target);
            break;
          case 'google2':
            out = await this.translateGoogle2(chunk, target);
            break;
          case 'yandex':
            out = await this.translateYandex(chunk, target);
            break;
          case 'tomato_gemini':
            out = await this.translateTomatoGemini(chunk, target);
            break;
          case 'longcat':
            out = await this.translateLongcat(chunk, target);
            break;
          case 'google':
          default:
            out = await this.translateGoogle(chunk, target);
            break;
        }
        // Defensive: when the API returns an unexpected shape we keep
        // the original lines so the reader still sees something.
        results.push(out.length === chunk.length ? out : chunk);
      } catch (err) {
        console.warn('TomatoMTL translation chunk failed:', err);
        results.push(chunk);
      }
    }
    return results.flat();
  }

  // ─── Plugin API: novel listings ────────────────────────────
  async popularNovels(
    pageNo: number,
    options: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const { filters, showLatestNovels } = options;

    const params = new URLSearchParams({
      ajax: '1',
      page_index: String(Math.max(0, pageNo - 1)),
      page_count: '18',
      gender: (filters?.gender?.value as string) || '-1',
      creation_status:
        (filters?.creation_status?.value as string) || '-1',
      word_count: (filters?.word_count?.value as string) || '-1',
      // showLatestNovels is the LNReader "Latest" tab; map it to sort=1.
      sort: showLatestNovels
        ? '1'
        : ((filters?.sort?.value as string) || '0'),
      category_id: (filters?.category_id?.value as string) || '-1',
    });

    const url = `${SITE}/fanqie-explorer?${params.toString()}`;
    const headers: Record<string, string> = {
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
      Referer: `${SITE}/fanqie-explorer`,
    };
    const cookieHeader = this.buildCookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    const res = await fetchApi(url, { headers });
    this.absorbSetCookie(res.headers.get('set-cookie'));

    const data = (await res.json().catch(() => null)) as {
      books?: { book_id?: string; book_name?: string; thumb_url?: string }[];
    } | null;
    if (!data || !Array.isArray(data.books)) return [];

    return data.books
      .filter(b => b && b.book_id)
      .map(book => ({
        name:
          String(book.book_name || '').trim() || `#${book.book_id}`,
        path: `/book/${book.book_id}`,
        cover: normalizeCoverUrl(book.thumb_url) || defaultCover,
      }));
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const trimmed = searchTerm.trim();
    if (!trimmed) return [];

    // The site exposes a same-origin proxy that forwards to the upstream
    // search service. Calling it directly avoids scraping the search
    // result HTML, which is rendered after the JSON arrives anyway.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Referer: `${SITE}/search?q=${encodeURIComponent(trimmed)}`,
    };
    const cookieHeader = this.buildCookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    const res = await fetchApi(`${SITE}/api/search-proxy.php`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: trimmed,
        page_index: Math.max(0, pageNo - 1),
        page_count: 10,
        query_type: 0,
      }),
    });
    this.absorbSetCookie(res.headers.get('set-cookie'));

    type SearchBook = {
      book_id?: string;
      book_name?: string;
      thumb_url?: string;
    };
    const data = (await res.json().catch(() => null)) as {
      search_tabs?: {
        data?: { book_data?: SearchBook[] }[];
      }[];
    } | null;
    if (!data || !Array.isArray(data.search_tabs)) return [];

    const novels: Plugin.NovelItem[] = [];
    const seen = new Set<string>();
    for (const tab of data.search_tabs) {
      const items = Array.isArray(tab?.data) ? tab.data : [];
      for (const item of items) {
        const books = Array.isArray(item?.book_data) ? item.book_data : [];
        for (const book of books) {
          const id = String(book?.book_id || '').trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          novels.push({
            name:
              String(book.book_name || '').trim() || `#${id}`,
            path: `/book/${id}`,
            cover: normalizeCoverUrl(book.thumb_url) || defaultCover,
          });
        }
      }
    }
    return novels;
  }

  // ─── Plugin API: novel details ─────────────────────────────
  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const bookId = extractBookId(novelPath);
    if (!bookId) throw new Error(`Invalid novel path: ${novelPath}`);

    const { html } = await this.fetchHtml(
      `${SITE}/book/${bookId}`,
    );
    const $ = parseHTML(html);

    // Title: page <title>/<og:title> are translated; original Chinese is
    // shown after "Original name:". We surface the translated title as the
    // primary `name` and keep the Chinese original visible in the summary.
    const translatedName =
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('title').text().trim() ||
      '';

    let originalName = '';
    $('.book-meta-item').each((_, el) => {
      const text = $(el).text();
      if (/Original name|Tên gốc/i.test(text)) {
        originalName = $(el).find('span').first().text().trim();
      }
    });

    const novel: Plugin.SourceNovel = {
      path: `/book/${bookId}`,
      name: translatedName || originalName || `#${bookId}`,
    };

    // Cover (the site uses wsrv.nl as a thumbnail proxy).
    const coverEl = $('#book_cover').first();
    novel.cover =
      coverEl.attr('data-src') ||
      coverEl.attr('src') ||
      $('meta[property="og:image"]').attr('content') ||
      defaultCover;

    // Author lives inside the "Author:" .book-meta-item button.
    let author = '';
    let status = '';
    let score = '';
    let chineseReaders = '';
    let lastUpdated = '';
    let createdAt = '';
    $('.book-meta-item').each((_, el) => {
      const $el = $(el);
      const label = $el.find('b').first().text().toLowerCase();
      const value = $el
        .clone()
        .find('b, i')
        .remove()
        .end()
        .text()
        .replace(/\|/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!author && label.includes('author')) {
        author = $el.find('button').first().text().trim() || value;
      } else if (!status && label.includes('status')) {
        status = $el.find('.badge').first().text().trim();
      } else if (!score && label.includes('score')) {
        score = value.replace(/[^0-9.]/g, '');
      } else if (label.includes('chinese readers')) {
        chineseReaders = value.replace(/[^0-9,]/g, '');
      } else if (label.includes('last updated')) {
        lastUpdated = $el.find('span').last().text().trim();
      } else if (label.includes('created')) {
        createdAt = $el.find('span').last().text().trim();
      }
    });
    novel.author = author;

    novel.genres = $('#book_categories a')
      .map((_, a) => $(a).text().trim())
      .get()
      .filter(Boolean)
      .join(',');

    novel.summary = ($('#description').text() || '').trim();
    if (originalName && translatedName && originalName !== translatedName) {
      novel.summary =
        `Tên gốc: ${originalName}\n` +
        (score ? `Điểm: ${score}\n` : '') +
        (chineseReaders ? `Lượt đọc CN: ${chineseReaders}\n` : '') +
        (lastUpdated ? `Cập nhật: ${lastUpdated}\n` : '') +
        (createdAt ? `Tạo: ${createdAt}\n` : '') +
        '\n' +
        novel.summary;
    }

    const normalized = status.toLowerCase();
    if (/ongoing|đang|loading/.test(normalized))
      novel.status = NovelStatus.Ongoing;
    else if (/completed|hoàn|finished/.test(normalized))
      novel.status = NovelStatus.Completed;
    else if (/hiatus|pause|tạm/.test(normalized))
      novel.status = NovelStatus.OnHiatus;
    else novel.status = NovelStatus.Unknown;

    novel.chapters = await this.fetchChapterList(bookId, html);
    return novel;
  }

  // The catalog endpoint returns the full chapter list as an encrypted
  // JSON blob. The decryption key (`unlock_code`) lives on the book HTML
  // page. We re-use the freshly-fetched book page rather than making a
  // second round trip.
  private async fetchChapterList(
    bookId: string,
    bookHtml: string,
  ): Promise<Plugin.ChapterItem[]> {
    let unlockCode = this.extractInlineString(bookHtml, 'unlock_code');
    if (!unlockCode) {
      const { html } = await this.fetchHtml(`${SITE}/book/${bookId}`);
      unlockCode = this.extractInlineString(html, 'unlock_code');
    }
    if (!unlockCode) {
      throw new Error(
        'Không lấy được mã giải mã (unlock_code) từ trang truyện. ' +
          'Trang web có thể đã thay đổi cấu trúc, hoặc bạn cần mở ' +
          'tomatomtl.com trong WebView của LNReader để vượt Cloudflare.',
      );
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Referer: `${SITE}/book/${bookId}`,
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 10; LNReader) AppleWebKit/537.36',
    };
    const cookieHeader = this.buildCookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    const res = await fetchApi(`${SITE}/catalog/${bookId}`, { headers });
    this.absorbSetCookie(res.headers.get('set-cookie'));

    if (!res.ok) {
      throw new Error(
        `Catalog request failed: HTTP ${res.status} ${res.statusText}. ` +
          'Hãy đăng nhập tomatomtl.com qua WebView rồi thử lại.',
      );
    }

    // The catalog endpoint always replies with JSON. If the body is HTML
    // (e.g. a Cloudflare interstitial or "Login Required" page) JSON.parse
    // will throw and we surface a helpful message instead of an empty list.
    const rawText = await res.text();
    let payload: EncryptedPayload | null;
    try {
      payload = JSON.parse(rawText) as EncryptedPayload;
    } catch {
      throw new Error(
        'Catalog không trả về JSON (có thể là trang Cloudflare/Login). ' +
          'Hãy mở https://tomatomtl.com trong WebView của LNReader, ' +
          'đăng nhập, rồi quay lại.',
      );
    }
    if (!payload || !payload.iv || !payload.enc) {
      throw new Error('Catalog JSON thiếu trường iv/enc.');
    }

    let plaintext: string;
    try {
      plaintext = this.decryptPayload(unlockCode, payload);
    } catch (err) {
      throw new Error(
        `Giải mã danh sách chương thất bại: ${(err as Error).message}`,
      );
    }

    type CatalogEntry = { id?: string; title?: string };
    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext);
    } catch {
      throw new Error('Danh sách chương sau khi giải mã không phải JSON hợp lệ.');
    }

    const entries: { id: string; title: string }[] = [];
    if (Array.isArray(parsed)) {
      for (const c of parsed as CatalogEntry[]) {
        const id = String(c?.id || '').trim();
        const title = String(c?.title || '').trim();
        if (id) entries.push({ id, title: title || `Chương ${id}` });
      }
    } else if (parsed && typeof parsed === 'object') {
      // Object map keyed by index.
      const obj = parsed as Record<string, CatalogEntry>;
      for (const key of Object.keys(obj)) {
        const c = obj[key];
        const id = String(c?.id || '').trim();
        const title = String(c?.title || '').trim();
        if (id) entries.push({ id, title: title || `Chương ${id}` });
      }
    }

    if (!entries.length) {
      throw new Error('Catalog trả về danh sách chương rỗng.');
    }

    // Group every 50 chapters into a "Volume" page label so the chapter
    // list mirrors the accordion the website itself shows. This makes
    // long catalogs (often 1k+ chapters) browsable inside LNReader.
    const chapters: Plugin.ChapterItem[] = entries.map((entry, idx) => {
      const chapterNumber = idx + 1;
      const start =
        Math.floor((chapterNumber - 1) / CHAPTERS_PER_VOLUME) *
          CHAPTERS_PER_VOLUME +
        1;
      const end = Math.min(start + CHAPTERS_PER_VOLUME - 1, entries.length);
      return {
        name: entry.title,
        path: `/book/${bookId}/${entry.id}`,
        chapterNumber,
        page: `Chương ${start} - ${end}`,
      };
    });
    return chapters;
  }

  // ─── Plugin API: chapter content ───────────────────────────
  async parseChapter(chapterPath: string): Promise<string> {
    const url = `${SITE}${chapterPath.startsWith('/') ? '' : '/'}${chapterPath}`;
    let { html } = await this.fetchHtml(url);

    if (this.detectLoginRequired(html)) {
      // Try to refresh the session once in case the WebView cookies
      // were just updated, then re-fetch.
      await this.warmUpSession();
      ({ html } = await this.fetchHtml(url));
      if (this.detectLoginRequired(html)) {
        throw new Error(
          'TomatoMTL yêu cầu đăng nhập để đọc chương.\n' +
            'Mở https://tomatomtl.com/user/login bằng trình duyệt trong app (LNReader → WebView), đăng nhập một lần để cookie được lưu, rồi thử lại.',
        );
      }
    }

    const unlockCode = this.extractInlineString(html, 'unlock_code');
    const payload = this.extractEncryptedData(html);
    if (!unlockCode || !payload) {
      throw new Error(
        'Không tìm thấy nội dung mã hóa trong trang chương. Trang web có thể đã thay đổi cấu trúc.',
      );
    }

    let plaintext: string;
    try {
      plaintext = this.decryptPayload(unlockCode, payload);
    } catch (err) {
      throw new Error(`Giải mã chương thất bại: ${(err as Error).message}`);
    }

    const $ = parseHTML(html);
    const chapterTitle =
      $('#chapter_title').first().text().trim() ||
      $('title').text().trim();

    // The decrypted blob is plain Chinese text with `\n` paragraph breaks.
    const rawLines = plaintext
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (!rawLines.length) {
      throw new Error('Nội dung chương rỗng sau khi giải mã.');
    }

    let translatedLines: string[] | null = null;
    const provider = this.translateProvider;
    if (provider !== 'none') {
      try {
        translatedLines = await this.translateChunked(
          rawLines,
          this.translateLanguage,
        );
      } catch (err) {
        console.warn('TomatoMTL: translation failed, returning raw text', err);
        translatedLines = null;
      }
    }

    const out: string[] = [];
    if (chapterTitle) {
      out.push(`<h2>${escapeHtml(chapterTitle)}</h2>`);
    }

    if (translatedLines && translatedLines.length === rawLines.length) {
      for (let i = 0; i < rawLines.length; i++) {
        const translated = translatedLines[i] || rawLines[i];
        if (this.showOriginal && translated !== rawLines[i]) {
          out.push(
            `<p>${escapeHtml(translated)}<br><span style="color:#888;font-size:0.9em">${escapeHtml(rawLines[i])}</span></p>`,
          );
        } else {
          out.push(`<p>${escapeHtml(translated)}</p>`);
        }
      }
    } else {
      for (const line of rawLines) {
        out.push(`<p>${escapeHtml(line)}</p>`);
      }
    }

    return out.join('\n');
  }

  private detectLoginRequired(html: string): boolean {
    return /Login Required|need to log in to read chapter content/i.test(html);
  }

  // ─── Filters mirror the /fanqie-explorer page selectors ────
  filters = {
    sort: {
      type: FilterTypes.Picker,
      label: 'Sắp xếp',
      value: '0',
      options: [
        { label: 'Phổ biến nhất', value: '0' },
        { label: 'Mới nhất', value: '1' },
        { label: 'Số chữ', value: '2' },
      ],
    },
    gender: {
      type: FilterTypes.Picker,
      label: 'Đối tượng',
      value: '-1',
      options: [
        { label: 'Tất cả', value: '-1' },
        { label: 'Nam (Male)', value: '1' },
        { label: 'Nữ (Female)', value: '0' },
      ],
    },
    creation_status: {
      type: FilterTypes.Picker,
      label: 'Trạng thái',
      value: '-1',
      options: [
        { label: 'Tất cả', value: '-1' },
        { label: 'Hoàn thành', value: '0' },
        { label: 'Đang ra', value: '1' },
      ],
    },
    word_count: {
      type: FilterTypes.Picker,
      label: 'Số chữ',
      value: '-1',
      options: [
        { label: 'Tất cả', value: '-1' },
        { label: 'Dưới 300k', value: '0' },
        { label: '300k - 500k', value: '1' },
        { label: '500k - 1M', value: '2' },
        { label: '1M - 2M', value: '3' },
        { label: 'Trên 2M', value: '4' },
      ],
    },
    category_id: {
      type: FilterTypes.Picker,
      label: 'Thể loại',
      value: '-1',
      options: CATEGORY_OPTIONS,
    },
  } satisfies Filters;
}

// ─── Helpers (module-scope so they don't end up on `this`) ───────────────
function extractBookId(path: string): string {
  const m = /\/book\/(\d+)/.exec(path);
  return m ? m[1] : '';
}

function normalizeCoverUrl(url: unknown): string {
  if (typeof url !== 'string' || !url) return '';
  // The explorer often returns http:// thumbnails that won't load on devices
  // forcing HTTPS. The wsrv.nl proxy works fine on either scheme.
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('http://')) return 'https://' + url.substring(7);
  return url;
}

function base64ToBytes(b64: string): Uint8Array {
  // Tolerate URL-safe variants and missing padding so we can decode the
  // unlock_code, IV and ciphertext that ship in the page payload.
  let s = (b64 || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  while (s.length % 4) s += '=';
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Buffer fallback for environments without atob (e.g. older Hermes).
  const Buf = (globalThis as { Buffer?: { from: (s: string, e: string) => Uint8Array } }).Buffer;
  if (Buf && typeof Buf.from === 'function') {
    return new Uint8Array(Buf.from(s, 'base64'));
  }
  throw new Error('No base64 decoder available');
}

function bytesToUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  // Manual UTF-8 decoder fallback.
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c < 128) {
      out += String.fromCharCode(c);
    } else if (c < 224) {
      out += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
    } else if (c < 240) {
      out += String.fromCharCode(
        ((c & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63),
      );
    } else {
      let cp =
        ((c & 7) << 18) |
        ((bytes[i++] & 63) << 12) |
        ((bytes[i++] & 63) << 6) |
        (bytes[i++] & 63);
      cp -= 0x10000;
      out += String.fromCharCode(
        0xd800 + (cp >> 10),
        0xdc00 + (cp & 0x3ff),
      );
    }
  }
  return out;
}

function escapeHtml(text: string): string {
  return String(text).replace(/[&<>"']/g, ch => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return ch;
    }
  });
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export default new TomatoMTLPlugin();
