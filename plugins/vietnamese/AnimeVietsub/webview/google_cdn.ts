import { b64urlDecode, descramble, stringUnshuffle } from './crypto';
import { nativeFetch } from './fetch';
import type { ResolvedMedia } from './types';
import { cleanupIframe, debugLog } from './utils';

/**
 * avsToken is intentionally split in the player HTML so scrapers that
 * regex a single "..." capture get a broken half. Reassemble string
 * concatenations, then fall back to window._avsSk / a lone literal.
 */
export function extractAvsToken(html: string): string | null {
  const concat = html.match(
    /const\s+avsToken\s*=\s*((?:"[^"]*"\s*(?:\+\s*)?)+)/,
  );
  if (concat) {
    const parts = concat[1].match(/"([^"]*)"/g);
    if (parts && parts.length) {
      const joined = parts.map(p => p.slice(1, -1)).join('');
      if (joined.length > 20 && joined.includes('.')) return joined;
    }
  }

  const single = html.match(/const\s+avsToken\s*=\s*"([^"]+)"/);
  if (single && single[1] && single[1].includes('.')) return single[1];

  const winLit = html.match(/window\._avsSk\s*=\s*"([^"]+)"/);
  if (winLit && winLit[1] && winLit[1].includes('.')) return winLit[1];

  return null;
}

export function extractAvsSid(html: string): string | null {
  const m =
    html.match(/const\s+avsSid\s*=\s*"([^"]+)"/) ||
    html.match(/avsSid\s*=\s*"([0-9a-fA-F]{8,})"/);
  return m ? m[1] : null;
}

export function isLegacyEncryptedPlaylist(m3u8Text: string): boolean {
  return !!(
    m3u8Text &&
    /[?&]_t=/.test(m3u8Text) &&
    m3u8Text.includes('#EXTINF') &&
    !isNewShieldPlaylist(m3u8Text)
  );
}

export function isNewShieldPlaylist(m3u8Text: string): boolean {
  return /SAMPLE-AES-CTR|urn:avs:shield|\/chunks\/|seg-key/i.test(m3u8Text);
}

export class ShieldDecryptUnsupportedError extends Error {
  constructor(message?: string) {
    super(message || 'AVS_SHIELD_UNSUPPORTED');
    this.name = 'ShieldDecryptUnsupportedError';
  }
}

function b64urlToBytes(str: string): Uint8Array {
  return b64urlDecode(str);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array((hex.length / 2) | 0);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

function parseEnvelope(b64: string): {
  cn: string;
  sk: string;
  ts: string;
  uid: string;
} | null {
  try {
    const bytes = b64urlToBytes(b64);
    if (bytes.length < 11) return null;
    if (
      bytes[0] !== 85 ||
      bytes[1] !== 83 ||
      bytes[2] !== 68 ||
      bytes[3] !== 75
    ) {
      return null;
    }
    const payloadLen = (bytes[5] << 8) | bytes[6];
    const payload = bytes.subarray(7, 7 + payloadLen);
    let str = '';
    for (let i = 0; i < payload.length; i++) str += String.fromCharCode(payload[i]);
    str = decodeURIComponent(escape(str));
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function jtiParts(token: string): { jti: string; jtiOdd: string; jtiEven: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const jti = String(payload.jti || '');
    if (!jti) return null;
    let jtiOdd = '';
    let jtiEven = '';
    for (let i = 0; i < jti.length; i++) {
      if (i % 2 === 1) jtiOdd += jti[i];
      else jtiEven += jti[i];
    }
    return { jti, jtiOdd, jtiEven };
  } catch {
    return null;
  }
}

function parsePlaylistSegments(m3u8Text: string): {
  headers: string[];
  segments: {
    fileId: string;
    index: number;
    tVal: string;
    cVal: string;
    url: string;
  }[];
  keyUrl: string;
  keyIv: string;
} {
  const headers: string[] = [];
  const segments: {
    fileId: string;
    index: number;
    tVal: string;
    cVal: string;
    url: string;
  }[] = [];
  let keyUrl = '';
  let keyIv = '';

  const lines = m3u8Text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      if (/^#EXT-X-KEY/i.test(trimmed)) {
        const uri = trimmed.match(/URI="([^"]+)"/);
        const iv = trimmed.match(/IV=([^,\s]+)/);
        if (uri) keyUrl = uri[1];
        if (iv) keyIv = iv[1];
      } else if (
        !/^#EXTINF:/i.test(trimmed) &&
        !/^#EXT-X-ENDLIST/i.test(trimmed)
      ) {
        headers.push(trimmed);
      }
      continue;
    }
    const fm = trimmed.match(/\/chunks\/([0-9a-f]{24})\//i);
    const tm = trimmed.match(/[?&]_t=([^&\s]+)/);
    if (!fm || !tm) continue;
    const sm = trimmed.match(/[?&](?:si|seq)=([^&]+)/);
    const cm = trimmed.match(/[?&]_c=([^&]+)/);
    segments.push({
      fileId: fm[1],
      index: sm ? parseInt(sm[1], 10) || 0 : segments.length,
      tVal: tm[1],
      cVal: cm ? cm[1] : '',
      url: trimmed,
    });
  }

  return { headers, segments, keyUrl, keyIv };
}

function buildM3u8Blob(headerLines: string[], segmentUrls: string[]): string {
  const body = [
    ...headerLines.filter(h => !/^#EXT-X-KEY/i.test(h)),
    ...segmentUrls,
    '#EXT-X-ENDLIST',
  ].join('\n');
  const blob = new Blob([body], { type: 'application/vnd.apple.mpegurl' });
  return URL.createObjectURL(blob);
}

function looksPlayableUrl(url: string): boolean {
  return /^https?:\/\//.test(url) && !/googleusercontent\.com\/.*=d$/i.test(url);
}

function looksLikeM3u8(text: string): boolean {
  return (
    typeof text === 'string' &&
    text.includes('#EXTM3U') &&
    text.includes('#EXTINF') &&
    !text.includes('data:video/mp2t;base64,Rx//EP') &&
    (text.includes('/hls/') ||
      text.includes('/chunks/') ||
      text.includes('.ts') ||
      text.includes('.mp4') ||
      text.includes('stream.googleapis') ||
      text.includes('googlevideo'))
  );
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    key as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign(
    'HMAC',
    k,
    new TextEncoder().encode(data) as unknown as BufferSource,
  );
  return new Uint8Array(buf);
}

async function aesCtrDecrypt(
  key: Uint8Array,
  counter: Uint8Array,
  data: Uint8Array,
  length = 64,
): Promise<Uint8Array> {
  const subtleKey = await crypto.subtle.importKey(
    'raw',
    key as unknown as BufferSource,
    { name: 'AES-CTR' },
    false,
    ['decrypt'],
  );
  const out = await crypto.subtle.decrypt(
    {
      name: 'AES-CTR',
      counter: counter as unknown as BufferSource,
      length,
    },
    subtleKey,
    data as unknown as BufferSource,
  );
  return new Uint8Array(out);
}

function makeIndexCounter(index: number): Uint8Array {
  const counter = new Uint8Array(16);
  counter[12] = (index >>> 24) & 0xff;
  counter[13] = (index >>> 16) & 0xff;
  counter[14] = (index >>> 8) & 0xff;
  counter[15] = index & 0xff;
  return counter;
}

/** Legacy 2-layer playlist decrypt (pre-shield-v3). */
async function decryptLegacyM3u8(
  m3u8Text: string,
  m3u8Headers: Record<string, string>,
  avsToken: string,
): Promise<ResolvedMedia> {
  const jwt = jtiParts(avsToken);
  const jtiOdd = jwt ? jwt.jtiOdd : '';

  let cn = '';
  let sk = '';
  let ts = '0';
  let uid = 'anon';

  const envHeader =
    m3u8Headers['x-envelope'] ||
    m3u8Headers['x-avs-envelope'] ||
    m3u8Headers['x-stream-envelope'] ||
    '';
  if (envHeader) {
    const envJson = parseEnvelope(envHeader);
    if (envJson) {
      cn = envJson.cn || '';
      sk = envJson.sk || '';
      ts = envJson.ts || '0';
      uid = envJson.uid || 'anon';
    }
  }
  if (!cn) cn = m3u8Headers['x-edge-tag'] || '';
  if (!sk) sk = m3u8Headers['x-cache-node'] || '';
  if (!ts || ts === '0') ts = m3u8Headers['x-request-trace'] || '0';
  if (uid === 'anon') {
    try {
      const pd = m3u8Headers['x-proxy-digest'];
      if (pd) uid = decodeURIComponent(pd);
    } catch {
      //
    }
  }
  if (!cn || !sk) throw new ShieldDecryptUnsupportedError('Thiếu cn/sk (legacy).');

  const lines = m3u8Text.split('\n');
  const tValues: string[] = [];
  const headerLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') {
      if (
        !line.match(/^#EXTINF:/) &&
        !line.match(/^#EXT-X-ENDLIST/) &&
        !line.match(/^#EXT-X-KEY/)
      ) {
        headerLines.push(line);
      }
    } else {
      const tm = line.match(/[?&]_t=([^&\s]+)/);
      if (tm) tValues.push(tm[1]);
    }
  }
  if (tValues.length === 0) {
    throw new ShieldDecryptUnsupportedError('Không tìm thấy _t (legacy).');
  }

  const concatenated = tValues.join('');
  const cnBytes = b64urlDecode(cn);
  const iv = cnBytes.slice(0, 12);

  const unshuffleMethods = [
    { name: 'lcg', fn: (s: string) => stringUnshuffle(s, sk) },
    { name: 'noShuffle', fn: (s: string) => s },
  ];
  const hmacFormats = [
    { name: 'harden', data: uid + ':' + ts + ':' + sk + ':0' },
    { name: 'plain', data: uid + ':' + ts + ':' + sk },
  ];

  for (const unshuffle of unshuffleMethods) {
    for (const hmac of hmacFormats) {
      const unshuffled = unshuffle.fn(concatenated);
      let encryptedBlob: Uint8Array;
      try {
        encryptedBlob = b64urlDecode(unshuffled);
      } catch {
        continue;
      }
      try {
        const hmacData = new TextEncoder().encode(hmac.data);
        const hmacKey = await crypto.subtle.importKey(
          'raw',
          cnBytes as unknown as BufferSource,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
        const gcmKeyBuf = await crypto.subtle.sign(
          'HMAC',
          hmacKey,
          hmacData as unknown as BufferSource,
        );
        const gcmKey = await crypto.subtle.importKey(
          'raw',
          gcmKeyBuf as unknown as BufferSource,
          { name: 'AES-GCM' },
          false,
          ['decrypt'],
        );
        const rawResult = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as unknown as BufferSource },
          gcmKey,
          encryptedBlob as unknown as BufferSource,
        );
        const rawBytes = new Uint8Array(rawResult);
        let m3u8Body = new TextDecoder().decode(rawBytes);
        if (
          m3u8Body.indexOf('#EXTINF') === -1 &&
          m3u8Body.indexOf('/hls/') === -1
        ) {
          const descrambled = descramble(rawBytes, sk, ts);
          m3u8Body = new TextDecoder().decode(descrambled);
        }
        let fullM3u8Text = headerLines.join('\n') + '\n' + m3u8Body;
        if (fullM3u8Text.indexOf('#EXT-X-ENDLIST') === -1) {
          fullM3u8Text += '\n#EXT-X-ENDLIST';
        }

        if (/\/hls\/[0-9a-f]{24}\.ts\?e=/i.test(fullM3u8Text) && jtiOdd) {
          const urls = await decryptHlsEParams(fullM3u8Text, jtiOdd);
          if (urls.length) {
            return {
              type: 'sources',
              sources: [{ file: buildM3u8Blob(headerLines, urls), type: 'hls' }],
            };
          }
        }
        if (fullM3u8Text.indexOf('#EXTINF') !== -1) {
          return {
            type: 'sources',
            sources: [{ file: buildM3u8Blob(headerLines, fullM3u8Text.split('\n').filter(Boolean)), type: 'hls' }],
          };
        }
      } catch {
        // next attempt
      }
    }
  }

  throw new ShieldDecryptUnsupportedError('Giải mã legacy thất bại.');
}

async function decryptHlsEParams(m3u8Text: string, jtiOdd: string): Promise<string[]> {
  const lines = m3u8Text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/\/hls\/([0-9a-f]{24})\.ts\?e=([^&\s]+).*?[?&]i=([^&\s]*)/i);
    if (!m) {
      if (line && !line.startsWith('#')) out.push(line.trim());
      continue;
    }
    try {
      const key = await hmacSha256(new TextEncoder().encode(jtiOdd), 'url-cipher|' + m[1]);
      const index = parseInt(m[3] || '0', 10) || 0;
      const dec = await aesCtrDecrypt(key, makeIndexCounter(index), b64urlDecode(m[2]));
      const url = new TextDecoder().decode(dec);
      // Skip known decoy image URLs; keep anything that looks like media.
      if (looksPlayableUrl(url)) out.push(url);
      else out.push(line.trim());
    } catch {
      out.push(line.trim());
    }
  }
  return out;
}

/** G6-style placeholder decrypt using session key material from the fake JWT. */
async function decryptShieldPlaceholders(
  segments: { fileId: string; index: number; tVal: string }[],
  headerLines: string[],
  token: string,
  env: { cn: string; sk: string; ts: string; uid: string } | null,
): Promise<string[] | null> {
  const jwt = jtiParts(token);
  if (!jwt) return null;
  const { jti, jtiOdd, jtiEven } = jwt;

  const keyCandidates: { name: string; key: Uint8Array }[] = [
    { name: 'jtiOddHex', key: hexToBytes(jtiOdd) },
    { name: 'jtiEvenHex', key: hexToBytes(jtiEven) },
    { name: 'jtiHex', key: hexToBytes(jti) },
    { name: 'jtiOddUtf8', key: new TextEncoder().encode(jtiOdd) },
  ];

  const signs = (fileId: string, index: number) => [
    'url-cipher|' + fileId,
    fileId,
    'url-cipher|' + fileId + '|' + index,
    'placeholder|' + fileId,
    'cdn|' + fileId,
    'url|' + fileId + '|' + index,
    fileId + ':' + index,
  ];

  const first = segments[0];
  if (!first) return null;

  // Probe one segment across key/sign combos.
  let best: { sign: string; keyName: string; key: Uint8Array } | null = null;
  for (const kc of keyCandidates) {
    for (const sd of signs(first.fileId, first.index)) {
      try {
        const derived = await hmacSha256(kc.key, sd);
        const dec = await aesCtrDecrypt(
          derived,
          makeIndexCounter(first.index),
          b64urlDecode(first.tVal),
        );
        const text = new TextDecoder().decode(dec);
        if (looksPlayableUrl(text) || looksLikeM3u8(text)) {
          best = { sign: sd, keyName: kc.name, key: kc.key };
          break;
        }
      } catch {
        //
      }
    }
    if (best) break;
  }

  // Broader probe: raw key + unshuffle variants on first segment.
  if (!best) {
    const unshuffles = [
      { name: 'raw', fn: (s: string) => s },
      { name: 'sk', fn: (s: string) => (env ? stringUnshuffle(s, env.sk) : s) },
      { name: 'salt', fn: (s: string) => stringUnshuffle(s, '721d85203cbd4bd2f340a74ea6acaa6e') },
    ];
    for (const kc of keyCandidates) {
      for (const u of unshuffles) {
        try {
          const data = b64urlDecode(u.fn(first.tVal));
          const dec = await aesCtrDecrypt(kc.key, makeIndexCounter(first.index), data);
          const text = new TextDecoder().decode(dec);
          if (looksPlayableUrl(text)) {
            debugLog('G6 probe hit: ' + kc.name + '/' + u.name);
            // Derive per-file URL using same key without HMAC (direct AES).
            const urls: string[] = [];
            for (const seg of segments) {
              const d = await aesCtrDecrypt(
                kc.key,
                makeIndexCounter(seg.index),
                b64urlDecode(u.fn(seg.tVal)),
              );
              const url = new TextDecoder().decode(d);
              urls.push(looksPlayableUrl(url) ? url : seg.fileId);
            }
            if (urls.every(u2 => looksPlayableUrl(u2))) {
              return urls;
            }
          }
        } catch {
          //
        }
      }
    }
  }

  if (!best) return null;

  debugLog('G6 combo: ' + best.keyName + ' + ' + best.sign);
  const urls: string[] = [];
  for (const seg of segments) {
    try {
      const derived = await hmacSha256(best.key, best.sign.replace(String(first.index), String(seg.index)));
      // sign was built for first fileId; rebuild per segment when pattern uses fileId
      const sign =
        best.sign.includes(first.fileId) && first.fileId !== seg.fileId
          ? best.sign.replace(first.fileId, seg.fileId)
          : best.sign;
      const key2 =
        sign !== best.sign ? await hmacSha256(best.key, sign) : derived;
      const dec = await aesCtrDecrypt(
        key2,
        makeIndexCounter(seg.index),
        b64urlDecode(seg.tVal),
      );
      const url = new TextDecoder().decode(dec);
      urls.push(looksPlayableUrl(url) ? url : seg.tVal);
    } catch {
      urls.push('');
    }
  }

  const ok = urls.filter(u => looksPlayableUrl(u)).length;
  debugLog('G6 urls playable ' + ok + '/' + urls.length);
  return ok > 0 ? urls : null;
}

type SiteRuntime = {
  pLoader?: any;
  fLoader?: any;
  decrypt?: any;
  g6?: () => any;
};

async function loadSiteDecryptRuntime(
  token: string,
  avsSid: string | null,
  expV: string,
): Promise<SiteRuntime> {
  const w = window as any;
  w._avsExpV = expV || '1.15.7';
  w._avsCryptoHarden = true;
  w._avsCryptoHardenShadow = true;
  w._avsCryptoHardenDisable = [];
  w._avsSk = token;
  w._avsCryptoSupported = !!(
    window.crypto &&
    (window.crypto as any).subtle &&
    (window.crypto as any).subtle.importKey
  );
  if (avsSid) w.avsSid = avsSid;
  w._avsDomains = [
    [97, 110, 105, 109, 101, 118, 105, 101, 116, 115, 117, 98, 46, 114, 117],
    [97, 110, 105, 109, 101, 118, 105, 101, 116, 115, 117, 98, 46, 112, 108],
    [97, 110, 105, 109, 101, 118, 105, 101, 116, 115, 117, 98, 46, 105, 100],
    [97, 110, 105, 109, 101, 118, 105, 101, 116, 115, 117, 98, 46, 98, 121],
    [97, 110, 105, 109, 101, 118, 105, 101, 116, 115, 117, 98, 46, 108, 111, 118, 101],
    [97, 110, 105, 109, 101, 118, 105, 101, 116, 115, 117, 98, 46, 115, 105, 116, 101],
    [108, 111, 99, 97, 108, 104, 111, 115, 116],
  ];

  const base = 'https://storage.googleapiscdn.com/static/';
  const q = '?v=' + encodeURIComponent(expV || '1.15.7');
  const files = [
    base + 'pako.min.js' + q,
    base + 'avs-loader.min.js' + q,
    base + 'avs-fingerprint.min.js' + q,
  ];

  for (const url of files) {
    try {
      const res = await nativeFetch(url, { Referer: 'https://storage.googleapiscdn.com/' });
      if (res.status !== 200 || !res.text) {
        debugLog('Runtime script fail ' + url + ' status=' + res.status);
        continue;
      }
      // eslint-disable-next-line no-eval
      (0, eval)(res.text);
      debugLog('Loaded ' + url.split('/').pop() + ' (' + res.text.length + ')');
    } catch (e: any) {
      debugLog('Runtime eval fail ' + url + ': ' + (e && e.message));
    }
  }

  return {
    pLoader: w.AvsPlaylistLoader,
    fLoader: w.AvsEncryptedLoader,
    decrypt: w._avsDecryptM3u8,
    g6: w._avsG6Diag,
  };
}

function makeStaticLoader(payload: string) {
  function StaticLoader(_config?: any) {
    //
  }
  StaticLoader.prototype.load = function (
    context: any,
    _config: any,
    callbacks: any,
  ) {
    const self: any = this;
    setTimeout(() => {
      if (self._aborted) return;
      callbacks.onSuccess(
        { loaded: 1, total: 1 },
        payload,
        { status: 200, url: context && context.url },
        context,
      );
    }, 0);
  };
  StaticLoader.prototype.abort = function () {
    (this as any)._aborted = true;
  };
  StaticLoader.prototype.destroy = function () {
    //
  };
  return StaticLoader;
}

function invokeLoader(
  LoaderCtor: any,
  payload: string,
  context: any,
  timeoutMs = 8000,
): Promise<string | null> {
  return new Promise(resolve => {
    let settled = false;
    const done = (v: string | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const StaticLoader = makeStaticLoader(payload);
      const inst = new LoaderCtor({ loader: StaticLoader, config: {} });
      const timer = setTimeout(() => done(null), timeoutMs);
      inst.load(
        context,
        { maxRetry: 0, timeout: timeoutMs - 500 },
        {
          onSuccess: (_stats: any, data: any) => {
            clearTimeout(timer);
            if (typeof data === 'string') done(data);
            else if (data instanceof ArrayBuffer) {
              done(new TextDecoder().decode(new Uint8Array(data)));
            } else done(null);
          },
          onError: () => {
            clearTimeout(timer);
            done(null);
          },
          onProgress: () => {
            //
          },
        },
      );
    } catch (e: any) {
      debugLog('invokeLoader throw: ' + (e && e.message));
      done(null);
    }
  });
}

async function decryptShieldM3u8(
  m3u8Text: string,
  m3u8Headers: Record<string, string>,
  avsToken: string,
  avsSid: string | null,
  playerUrl: string,
): Promise<ResolvedMedia> {
  const envHeader =
    m3u8Headers['x-envelope'] ||
    m3u8Headers['x-avs-envelope'] ||
    '';
  const env = envHeader ? parseEnvelope(envHeader) : null;
  const parsed = parsePlaylistSegments(m3u8Text);
  debugLog(
    'Shield playlist: segs=' +
      parsed.segments.length +
      ' key=' +
      (parsed.keyUrl ? 'yes' : 'no'),
  );

  const expV = ((window as any)._avsExpV as string) || '1.15.7';

  // Path A: site loader runtime + pLoader/fLoader (G6 lives here).
  try {
    const runtime = await loadSiteDecryptRuntime(avsToken, avsSid, expV);
    if (runtime.g6) {
      try {
        debugLog('G6: ' + JSON.stringify(runtime.g6()));
      } catch {
        //
      }
    }
    if (runtime.pLoader) {
      const playlistUrl =
        playerUrl.replace(/\/player\/.*$/, '') +
        '/playlist/' +
        (playerUrl.match(/\/player\/([0-9a-f]+)/i) || [, ''])[1] +
        '/playlist.m3u8?token=' +
        encodeURIComponent(avsToken);
      const viaLoader =
        (await invokeLoader(runtime.pLoader, m3u8Text, {
          url: playlistUrl,
          responseType: 'text',
          type: 'manifest',
          level: 0,
          headers: m3u8Headers,
          networkDetails: { responseHeaders: m3u8Headers },
        })) || (await invokeLoader(runtime.pLoader, m3u8Text, {
          url: playlistUrl,
          responseType: 'text',
          type: 'level',
          level: 0,
        }));
      if (viaLoader && looksLikeM3u8(viaLoader) && !isNewShieldPlaylist(viaLoader)) {
        debugLog('pLoader returned playable m3u8 (' + viaLoader.length + ')');
        const urls = viaLoader
          .split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'));
        return {
          type: 'sources',
          sources: [{ file: buildM3u8Blob(parsed.headers, urls), type: 'hls' }],
        };
      }
      if (viaLoader && looksLikeM3u8(viaLoader)) {
        // May still contain chunks; try G6 on the loader output.
        const parsed2 = parsePlaylistSegments(viaLoader);
        if (parsed2.segments.length) {
          const urls2 = await decryptShieldPlaceholders(
            parsed2.segments,
            parsed2.headers,
            avsToken,
            env,
          );
          if (urls2) {
            return {
              type: 'sources',
              sources: [{ file: buildM3u8Blob(parsed2.headers, urls2), type: 'hls' }],
            };
          }
        }
      }
    }

    if (runtime.decrypt) {
      const dec =
        (await runtime.decrypt(m3u8Text, avsToken, m3u8Headers)) ||
        (await runtime.decrypt(m3u8Text, { token: avsToken, headers: m3u8Headers }));
      if (typeof dec === 'string' && looksLikeM3u8(dec)) {
        const urls = dec
          .split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'));
        return {
          type: 'sources',
          sources: [{ file: buildM3u8Blob(parsed.headers, urls), type: 'hls' }],
        };
      }
    }
  } catch (e: any) {
    debugLog('Site runtime decrypt fail: ' + (e && e.message));
  }

  // Path B: pure JS placeholder decrypt (sessionKey from fake JWT).
  if (parsed.segments.length) {
    const urls = await decryptShieldPlaceholders(
      parsed.segments,
      parsed.headers,
      avsToken,
      env,
    );
    if (urls && urls.some(looksPlayableUrl)) {
      debugLog('Placeholder decrypt OK');
      return {
        type: 'sources',
        sources: [{ file: buildM3u8Blob(parsed.headers, urls), type: 'hls' }],
      };
    }
  }

  throw new ShieldDecryptUnsupportedError(
    'AVS shield v3: không giải mã được m3u8 (cần loader site).',
  );
}

export async function resolveGoogleApisCdn(
  playerUrl: string,
): Promise<ResolvedMedia> {
  const iframe = document.createElement('iframe');
  iframe.style.cssText =
    'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
  iframe.src = playerUrl;
  (document.body || document.documentElement).appendChild(iframe);

  // Also warm stream CDN CF (chunks live here).
  const streamIframe = document.createElement('iframe');
  streamIframe.style.cssText = iframe.style.cssText;
  try {
    const origin = new URL(playerUrl).origin;
    const streamOrigin = origin.includes('storage.googleapiscdn.com')
      ? origin.replace('storage.googleapiscdn.com', 'stream.googleapiscdn.com')
      : origin;
    streamIframe.src = streamOrigin + '/';
    (document.body || document.documentElement).appendChild(streamIframe);
  } catch {
    //
  }

  const cfWait = 2000;
  debugLog('Đợi CF ' + cfWait + 'ms…');
  await new Promise(resolve => setTimeout(resolve, cfWait));
  debugLog('CF done, fetching page…');

  return await fetchPlayerPage(playerUrl, iframe);
}

async function fetchPlayerPage(
  playerUrl: string,
  iframe: HTMLIFrameElement,
): Promise<ResolvedMedia> {
  try {
    const res = await nativeFetch(playerUrl, { Referer: playerUrl });
    if (res.status !== 200) {
      throw new Error('HTTP ' + res.status + ' (len=' + (res.text || '').length + ')');
    }

    const html = res.text;
    debugLog('Page OK, size=' + html.length);
    cleanupIframe(iframe);

    const avsToken = extractAvsToken(html);
    if (!avsToken) {
      throw new Error('Không tìm thấy avsToken trong HTML.');
    }
    const avsSid = extractAvsSid(html);
    debugLog('Token: ' + avsToken.substring(0, 24) + '… sid=' + avsSid);

    const hashMatch = playerUrl.match(/\/player\/([0-9a-f]+)/i);
    if (!hashMatch) {
      throw new Error('Không tìm thấy video hash trong URL.');
    }
    const videoHash = hashMatch[1];

    const baseUrlMatch = playerUrl.match(/^(https?:\/\/[^/]+)/);
    if (!baseUrlMatch) throw new Error('Không lấy được baseUrl.');
    const baseUrl = baseUrlMatch[1];

    const m3u8Url =
      baseUrl +
      '/playlist/' +
      videoHash +
      '/playlist.m3u8?token=' +
      encodeURIComponent(avsToken);

    const m3u8Res = await nativeFetch(m3u8Url, { Referer: playerUrl });
    const m3u8Text = m3u8Res.text;
    const m3u8Headers = m3u8Res.headers || {};
    debugLog('m3u8 OK, size=' + m3u8Text.length);

    if (isLegacyEncryptedPlaylist(m3u8Text)) {
      debugLog('Legacy encrypted playlist — 2-layer decrypt');
      return await decryptLegacyM3u8(m3u8Text, m3u8Headers, avsToken);
    }

    if (isNewShieldPlaylist(m3u8Text)) {
      debugLog('AVS shield v3 playlist — full decrypt path');
      return await decryptShieldM3u8(
        m3u8Text,
        m3u8Headers,
        avsToken,
        avsSid,
        playerUrl,
      );
    }

    // Already playable URLs?
    const urls = m3u8Text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
    if (urls.length && urls.some(looksPlayableUrl)) {
      return {
        type: 'sources',
        sources: [{ file: buildM3u8Blob([], urls), type: 'hls' }],
      };
    }

    throw new ShieldDecryptUnsupportedError('Playlist không nhận dạng được.');
  } catch (err: any) {
    cleanupIframe(iframe);
    debugLog('Fetch/decrypt fail: ' + err.message);
    throw err;
  }
}
