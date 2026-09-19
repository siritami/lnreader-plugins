import { b64urlDecode, descramble, stringUnshuffle } from './crypto';
import { nativeFetch, nativeFetchBuffer } from './fetch';
import type { ResolvedMedia } from './types';
import { cleanupIframe, debugLog } from './utils';

/**
 * avsToken is intentionally split in the player HTML so scrapers that
 * regex a single "..." capture get a broken half.
 *
 * Live format (browser-verified):
 *   const avsToken = "eyJ…(~178)" + "GRm…(~178)";
 * Join all quoted pieces. Fallback to window._avsSk / a lone literal.
 */
export function extractAvsToken(html: string): string | null {
  // Prefer concatenation: "part1" + "part2" [+ "part3"...]
  const concat = html.match(
    /const\s+avsToken\s*=\s*((?:"[^"]*"\s*(?:\+\s*)?)+)/,
  );
  if (concat) {
    const parts = concat[1].match(/"([^"]*)"/g);
    if (parts && parts.length) {
      const joined = parts.map(p => p.slice(1, -1)).join('');
      if (joined.length > 20 && joined.includes('.')) {
        debugLog(
          'avsToken concat parts=' +
            parts.length +
            ' lens=' +
            parts.map(p => p.length - 2).join(',') +
            ' joined=' +
            joined.length,
        );
        return joined;
      }
    }
  }

  const single = html.match(/const\s+avsToken\s*=\s*"([^"]+)"/);
  if (single && single[1] && single[1].includes('.')) {
    debugLog('avsToken single len=' + single[1].length + ' (maybe truncated)');
    return single[1];
  }

  const winLit = html.match(/window\._avsSk\s*=\s*"([^"]+)"/);
  if (winLit && winLit[1] && winLit[1].includes('.')) {
    debugLog('avsToken window._avsSk len=' + winLit[1].length);
    return winLit[1];
  }

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
    for (const b of payload) str += String.fromCharCode(b);
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
  if (!/^https?:\/\//i.test(url)) return false;
  // Known anti-scraper decoys from old url-cipher path.
  if (/googleusercontent\.com\//i.test(url)) return false;
  if (/lh3\.googleusercontent|lh6\.googleusercontent/i.test(url)) return false;
  return true;
}

function looksLikeMediaUrl(url: string): boolean {
  if (!looksPlayableUrl(url)) return false;
  return (
    /\.(ts|m4s|mp4|m3u8|mpd|webm|mkv)(\?|$)/i.test(url) ||
    /\/hls\//i.test(url) ||
    /stream\.googleapis/i.test(url) ||
    /googlevideo\.com/i.test(url)
  );
}

function looksLikeM3u8(text: string): boolean {
  return (
    typeof text === 'string' &&
    text.includes('#EXTM3U') &&
    text.includes('#EXTINF') &&
    !text.includes('data:video/mp2t;base64,Rx//EP')
  );
}

function extractMediaUrls(m3u8Text: string): string[] {
  return m3u8Text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && looksLikeMediaUrl(l));
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    key as never,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign(
    'HMAC',
    k,
    new TextEncoder().encode(data) as never,
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
    key as never,
    { name: 'AES-CTR' },
    false,
    ['decrypt'],
  );
  const out = await crypto.subtle.decrypt(
    {
      name: 'AES-CTR',
      counter: counter as never,
      length,
    },
    subtleKey,
    data as never,
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
          cnBytes as never,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
        const gcmKeyBuf = await crypto.subtle.sign(
          'HMAC',
          hmacKey,
          hmacData as never,
        );
        const gcmKey = await crypto.subtle.importKey(
          'raw',
          gcmKeyBuf as never,
          { name: 'AES-GCM' },
          false,
          ['decrypt'],
        );
        const rawResult = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as never },
          gcmKey,
          encryptedBlob as never,
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
  if (env) {
    if (env.cn) keyCandidates.push({ name: 'cnUtf8', key: new TextEncoder().encode(env.cn) });
    if (env.sk) keyCandidates.push({ name: 'skUtf8', key: new TextEncoder().encode(env.sk) });
    if (env.uid && /^[0-9a-f]+$/i.test(env.uid)) {
      keyCandidates.push({ name: 'uidHex', key: hexToBytes(env.uid.slice(0, 64)) });
    }
  }

  const signs = (fileId: string, index: number) => {
    const list = [
      'url-cipher|' + fileId,
      fileId,
      'url-cipher|' + fileId + '|' + index,
      'placeholder|' + fileId,
      'cdn|' + fileId,
      'url|' + fileId + '|' + index,
      fileId + ':' + index,
    ];
    if (env) {
      list.push(env.cn + '|' + env.sk + '|' + env.ts);
      list.push(env.sk + '|' + fileId);
      list.push(env.uid + '|' + fileId);
      list.push('url-cipher|' + fileId + '|' + env.ts);
    }
    return list;
  };

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
  keysSeen: string[];
};

function bytesHex(u: Uint8Array, max = 32): string {
  let s = '';
  for (let i = 0; i < Math.min(u.length, max); i++) {
    s += u[i].toString(16).padStart(2, '0');
  }
  return s + (u.length > max ? '…' : '');
}

function installCryptoProbe(keysSeen: string[]) {
  const subtle = window.crypto && (window.crypto as any).subtle;
  if (!subtle || (subtle as any).__avsProbed) return;
  const origImport = subtle.importKey.bind(subtle);
  (subtle as any).__avsProbed = true;
  (subtle as any).importKey = async function (
    format: any,
    keyData: any,
    algo: any,
    extractable: any,
    usages: any,
  ) {
    try {
      let preview = '';
      if (typeof keyData === 'string') preview = keyData.slice(0, 64);
      else if (keyData instanceof ArrayBuffer) {
        preview = bytesHex(new Uint8Array(keyData));
      } else if (ArrayBuffer.isView(keyData)) {
        const u = new Uint8Array(
          (keyData as any).buffer,
          (keyData as any).byteOffset,
          (keyData as any).byteLength,
        );
        preview = bytesHex(u);
      }
      const algoName = (algo && algo.name) || String(algo);
      const rec = algoName + ':' + preview;
      if (keysSeen.length < 40) keysSeen.push(rec);
    } catch {
      //
    }
    return origImport(format, keyData, algo, extractable, usages);
  };
}

type RuntimeCapture = {
  urls: string[];
  blobs: string[];
  dataUris: string[];
  crypto: string[];
  installed: boolean;
};

function getCapture(): RuntimeCapture {
  const w = window as any;
  if (!w.__avsCapture) {
    w.__avsCapture = {
      urls: [],
      blobs: [],
      dataUris: [],
      crypto: [],
      installed: false,
    } as RuntimeCapture;
  }
  return w.__avsCapture as RuntimeCapture;
}

function looksLikePlayableM3u8(text: string): boolean {
  if (!text || text.indexOf('#EXTM3U') === -1) return false;
  if (text.indexOf('data:video/mp2t;base64,Rx//EP') !== -1) return false;
  if (text.indexOf('data:video/mp2t;base64,Rx//EP') !== -1) return false;
  const urls = text.split('\n').filter(l => l && l[0] !== '#');
  const media = urls.filter(u => looksLikeMediaUrl(u));
  return media.length >= 1 && !isNewShieldPlaylist(text);
}

function collectPlayableFromCapture(): string | null {
  const cap = getCapture();
  const candidates: string[] = [
    ...cap.blobs,
    ...cap.dataUris.map(s => {
      try {
        return s.startsWith('data:') ? atob(s.split(',')[1] || '') : s;
      } catch {
        return '';
      }
    }),
  ];
  for (const c of candidates) {
    if (looksLikePlayableM3u8(c)) return c;
  }
  return null;
}

/**
 * Hook network/blob BEFORE evaluating site scripts so their closed-over
 * fetch still reports rewritten URLs and decrypted m3u8 blobs.
 */
function installRuntimeCapture(): RuntimeCapture {
  const cap = getCapture();
  if (cap.installed) return cap;
  cap.installed = true;
  const w = window as any;

  try {
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (obj: any) {
      const url = origCreate(obj);
      try {
        if (obj instanceof Blob) {
          cap.urls.push('blob:' + (obj.type || '') + ':' + (obj.size || 0));
          if (obj.size && obj.size < 2 * 1024 * 1024) {
            const fr = new FileReader();
            fr.onload = () => {
              const t = String(fr.result || '');
              if (t.indexOf('#EXTM3U') !== -1 || t.indexOf('https://') !== -1) {
                cap.blobs.push(t);
                debugLog('capture blob m3u8 len=' + t.length);
              }
            };
            fr.readAsText(obj);
          }
        }
      } catch (e: any) {
        cap.crypto.push('blobErr:' + e.message);
      }
      return url;
    };
  } catch (e: any) {
    debugLog('createObjectURL hook fail: ' + e.message);
  }

  try {
    const origFetch = w.fetch ? w.fetch.bind(w) : null;
    if (origFetch) {
      w.fetch = async function (input: any, init?: any) {
        const url =
          typeof input === 'string'
            ? input
            : (input && input.url) || String(input);
        if (/hls|chunks|playlist|m3u8|seg-key|stream\./i.test(String(url))) {
          cap.urls.push(String(url).slice(0, 200));
        }
        const res = await origFetch(input, init);
        try {
          const ct = res.headers && res.headers.get && res.headers.get('content-type');
          if (
            ct &&
            /mpegurl|m3u8|text\/plain/i.test(ct) &&
            res.clone
          ) {
            const clone = res.clone();
            clone
              .text()
              .then((t: string) => {
                if (t && looksLikePlayableM3u8(t)) cap.blobs.push(t);
              })
              .catch(() => {
                // ignore clone read errors
              });
          }
        } catch {
          //
        }
        return res;
      };
    }
  } catch (e: any) {
    debugLog('fetch hook fail: ' + e.message);
  }

  try {
    const OrigXHR = w.XMLHttpRequest;
    if (OrigXHR) {
      const Wrapped = function (this: any) {
        const xhr = new OrigXHR();
        const open = xhr.open;
        xhr.open = function (m: string, u: string, ...rest: any[]) {
          try {
            if (/hls|chunks|playlist|m3u8|seg-key|stream\./i.test(String(u))) {
              cap.urls.push(String(u).slice(0, 200));
            }
          } catch {
            //
          }
          return open.apply(xhr, [m, u, ...rest] as any);
        };
        return xhr;
      } as any;
      Wrapped.prototype = OrigXHR.prototype;
      w.XMLHttpRequest = Wrapped;
    }
  } catch (e: any) {
    debugLog('xhr hook fail: ' + e.message);
  }

  debugLog('Runtime capture installed');
  return cap;
}

async function loadSiteDecryptRuntime(
  token: string,
  avsSid: string | null,
  expV: string,
  boot?: {
    playerId?: string;
    playerUrl?: string;
    m3u8Text?: string;
    m3u8Headers?: Record<string, string>;
    playlistUrl?: string;
  },
): Promise<SiteRuntime> {
  const w = window as any;
  const keysBefore = new Set(Object.getOwnPropertyNames(window));
  const keysSeen: string[] = [];
  installCryptoProbe(keysSeen);

  const playerId = (boot && boot.playerId) || '';
  const m3u8Text = (boot && boot.m3u8Text) || '';
  const m3u8Headers = (boot && boot.m3u8Headers) || {};
  const playlistUrl = (boot && boot.playlistUrl) || '';

  // Must run BEFORE eval so site code binds our wrappers.
  installRuntimeCapture();

  w._avsExpV = expV || '1.15.7';
  w._avsCryptoHarden = true;
  w._avsCryptoHardenShadow = true;
  w._avsCryptoHardenDisable = [];
  w._avsSk = token;
  // init.js / player page globals (const in their HTML → must be window.*)
  w.avsToken = token;
  if (avsSid) w.avsSid = avsSid;
  w.id = playerId;
  w.playerId = playerId;
  w.title = playerId;
  w._avsCryptoSupported = !!(
    window.crypto &&
    (window.crypto as any).subtle &&
    (window.crypto as any).subtle.importKey
  );
  w.nextName = '';
  w.nextUrl = '';
  w.schedule = '';
  w.isFinal = '';
  w.adsConfig = '';
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

  // Mock JWPlayer + #player so init.js can run without replacing the reader.
  try {
    const w2 = window as any;
    if (typeof w2.jwplayer !== 'function') {
      const mockPlayer = {
        on: () => mockPlayer,
        once: () => mockPlayer,
        setup: () => mockPlayer,
        play: () => mockPlayer,
        pause: () => mockPlayer,
        remove: () => mockPlayer,
        getState: () => 'idle',
        getPosition: () => 0,
        getDuration: () => 0,
        getPlaylist: () => [],
        getPlaylistItem: () => null,
        getConfig: () => ({ hlsjsConfig: {}, provider: null }),
        getContainer: () => document.getElementById('avs-player-container'),
      };
      const jw: any = function () {
        return mockPlayer;
      };
      jw.defaults = { key: '' };
      jw.version = '8.0.0-mock';
      w2.jwplayer = jw;
    }
    if (!document.getElementById('player')) {
      const div = document.createElement('div');
      div.id = 'player';
      div.style.cssText = 'width:1px;height:1px;position:absolute;opacity:0;';
      document.body.appendChild(div);
    }
  } catch (e: any) {
    debugLog('jw mock err: ' + e.message);
  }

  for (const url of files) {
    try {
      const res = await nativeFetch(url, {
        Referer: 'https://storage.googleapiscdn.com/',
      });
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

  // init.js completes pLoader/hls wiring the site player uses.
  try {
    const initRes = await nativeFetch(base + 'init.min.js' + q, {
      Referer: 'https://storage.googleapiscdn.com/',
    });
    if (initRes.status === 200 && initRes.text && initRes.text.length > 1000) {
      debugLog('Evaluating init.min.js (' + initRes.text.length + ') avsToken=' + typeof w.avsToken);
      // eslint-disable-next-line no-eval
      (0, eval)(initRes.text);
      debugLog('Loaded init.min.js OK');
    } else {
      debugLog('init.min.js skip st=' + initRes.status + ' len=' + (initRes.text || '').length);
    }
  } catch (e: any) {
    debugLog('init.min.js eval fail: ' + (e && e.message));
  }

  // Site player boot path: _decryptAndStart(xhrLike) — needs getAllResponseHeaders.
  try {
    const w3 = window as any;
    if (typeof w3._decryptAndStart === 'function') {
      debugLog(
        '_decryptAndStart arity=' +
          w3._decryptAndStart.length +
          ' id=' +
          w3.id +
          ' body=' +
          (m3u8Text ? m3u8Text.length : 0),
      );
      const hdrMap = normalizeHeaderMap(m3u8Headers);
      if (token) {
        const shaped = shapeEnvelopeHeader(hdrMap['x-envelope'] || '');
        if (shaped) {
          hdrMap['X-Envelope'] = shaped;
          hdrMap['x-envelope'] = shaped;
        }
      }
      if (!w3.avsG && w3._avsGuard) {
        w3.avsG = w3._avsGuard;
        debugLog('avsG := _avsGuard ' + String(w3.avsG).slice(0, 24));
      }
      const headerString = Object.keys(hdrMap)
        .map(k => k.toLowerCase() + ': ' + hdrMap[k] + '\r\n')
        .join('');
      const getHdr = (name: string): string => {
        if (!name) return '';
        const n = String(name);
        const v = hdrMap[n] != null ? hdrMap[n] : hdrMap[n.toLowerCase()];
        return v != null ? String(v) : '';
      };
      const xhrLike: any = {
        status: 200,
        statusText: 'OK',
        readyState: 4,
        responseText: m3u8Text || '',
        response: m3u8Text || '',
        body: m3u8Text || '',
        data: m3u8Text || '',
        responseURL: playlistUrl || '',
        finalUrl: playlistUrl || '',
        url: playlistUrl || '',
        responseType: 'text',
        headers: hdrMap,
        responseHeaders: hdrMap,
        getAllResponseHeaders: () => headerString,
        getResponseHeader: getHdr,
        // Common hls/avs context fields (.slice on url/path/finalUrl)
        context: {
          url: playlistUrl || '',
          levelurl: playlistUrl || '',
          responseType: 'text',
          type: 'manifest',
          level: 0,
          headers: hdrMap,
          responseHeaders: hdrMap,
          responseText: m3u8Text || '',
          getResponseHeader: getHdr,
          getAllResponseHeaders: () => headerString,
          frag: {
            type: 'playlist',
            level: 0,
            url: playlistUrl || '',
            relurl: playlistUrl || '',
            baseurl: (playlistUrl || '').replace(/[^/]*$/, ''),
            baseURL: (playlistUrl || '').replace(/[^/]*$/, ''),
            sn: 0,
          },
        },
        stats: {
          aborted: false,
          loaded: (m3u8Text || '').length,
          total: (m3u8Text || '').length,
          retry: 0,
          loading: {
            start: Date.now() - 40,
            first: Date.now() - 10,
            end: Date.now(),
          },
        },
        networkDetails: null, // set below
      };
      xhrLike.networkDetails = xhrLike;
      const candidates: any[] = [
        ['xhr+playlistUrl', xhrLike],
      ];
      for (const [label, arg] of candidates) {
        try {
          const r = await w3._decryptAndStart(arg);
          debugLog(
            '_decryptAndStart(' +
              label +
              ') → ' +
              (typeof r === 'string'
                ? r.slice(0, 140)
                : JSON.stringify(r).slice(0, 200)),
          );
        } catch (e: any) {
          debugLog('_decryptAndStart(' + label + ') err: ' + (e && e.message));
        }
      }
      if (w3._avsG6Diag) {
        try {
          debugLog('G6 after decryptAndStart: ' + JSON.stringify(w3._avsG6Diag()));
        } catch {
          //
        }
      }
    } else {
      debugLog('_decryptAndStart missing (' + typeof w3._decryptAndStart + ') id=' + w3.id);
    }
  } catch (e: any) {
    debugLog('decryptAndStart probe err: ' + e.message);
  }

  const newKeys = Object.getOwnPropertyNames(window).filter(k => !keysBefore.has(k));
  const interesting = newKeys
    .filter(k => /avs|loader|decrypt|hls|session|key/i.test(k))
    .slice(0, 40);
  debugLog('Runtime APIs: pLoader=' + typeof w.AvsPlaylistLoader +
    ' fLoader=' + typeof w.AvsEncryptedLoader +
    ' decrypt=' + typeof w._avsDecryptM3u8 +
    ' g6=' + typeof w._avsG6Diag);
  debugLog('New keys: ' + interesting.join(','));

  return {
    pLoader: w.AvsPlaylistLoader,
    fLoader: w.AvsEncryptedLoader,
    decrypt: w._avsDecryptM3u8,
    g6: w._avsG6Diag,
    keysSeen,
  };
}

function dumpCaptureSummary() {
  const cap = getCapture();
  debugLog(
    'capture urls=' +
      cap.urls.length +
      ' blobs=' +
      cap.blobs.length +
      ' dataUris=' +
      cap.dataUris.length,
  );
  if (cap.urls.length) {
    debugLog('capture url sample: ' + cap.urls.slice(-5).join(' | ').slice(0, 240));
  }
  if (cap.blobs.length) {
    const last = cap.blobs[cap.blobs.length - 1];
    debugLog(
      'capture blob head: ' +
        last.slice(0, 80).replace(/\n/g, '|') +
        ' playable=' +
        looksLikePlayableM3u8(last),
    );
  }
}

type LoaderProbe = {
  url: string;
  status?: number;
  len?: number;
  note?: string;
};

/** hls.js / avs-loader expect XMLHttpRequest-shaped networkDetails. */
function normalizeHeaderMap(headerMap: Record<string, string> | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  const raw = headerMap || {};
  Object.keys(raw).forEach(k => {
    const v = raw[k];
    if (v == null) return;
    const lk = String(k).toLowerCase();
    map[lk] = String(v);
    // Mirror common casings avs-loader may index directly.
    map[k] = String(v);
    if (lk === 'content-type') map['Content-Type'] = String(v);
    if (lk === 'x-envelope') {
      map['X-Envelope'] = String(v);
      map['X-Envelope'] = String(v);
    }
  });
  // Never leave these undefined for `.split` call sites.
  if (!map['content-type']) {
    const ct = 'application/vnd.apple.mpegurl; charset=utf-8';
    map['content-type'] = ct;
    map['Content-Type'] = ct;
  }
  return map;
}

function buildNetworkDetails(
  status: number,
  url: string,
  headerMap: Record<string, string>,
) {
  const map = normalizeHeaderMap(headerMap);
  return {
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : String(status),
    url,
    responseHeaders: map,
    headers: map,
    getAllResponseHeaders(): string {
      const seen = new Set<string>();
      const lines: string[] = [];
      Object.keys(map).forEach(k => {
        const lk = k.toLowerCase();
        if (seen.has(lk)) return;
        seen.add(lk);
        lines.push(lk + ': ' + map[k] + '\r\n');
      });
      return lines.join('');
    },
    getResponseHeader(name: string): string {
      if (!name) return '';
      const n = String(name);
      const v = map[n] != null ? map[n] : map[n.toLowerCase()];
      return v != null ? String(v) : '';
    },
  };
}

function buildLoaderStats(loaded: number) {
  const now = Date.now();
  return {
    aborted: false,
    loaded,
    total: loaded,
    retry: 0,
    chunkCount: 1,
    bwEstimate: loaded,
    loading: { start: now - 40, first: now - 10, end: now },
  };
}

/**
 * Inner hls.js loader that uses reader.fetch. avs pLoader often reads
 * headers from the loader *instance* (this.headers / getResponseHeader),
 * not only from the networkDetails argument.
 */
function makeReaderLoader(
  probes: LoaderProbe[],
  referer: string,
  extraHeaders?: Record<string, string>,
  knownHeadersByMatch?: { match: string; headers: Record<string, string> }[],
) {
  function ReaderLoader(_config?: any) {
    this._aborted = false;
    this.status = 0;
    this.headers = {};
    this.responseHeaders = {};
    this.stats = buildLoaderStats(0);
  }
  ReaderLoader.prototype.getResponseHeader = function (name: string): string {
    const map = (this as any).headers || (this as any).responseHeaders || {};
    if (!name) return '';
    const n = String(name);
    const v = map[n] != null ? map[n] : map[n.toLowerCase()];
    return v != null ? String(v) : '';
  };
  ReaderLoader.prototype.getAllResponseHeaders = function (): string {
    const map = (this as any).headers || {};
    const seen = new Set<string>();
    const lines: string[] = [];
    Object.keys(map).forEach((k: string) => {
      const lk = k.toLowerCase();
      if (seen.has(lk)) return;
      seen.add(lk);
      lines.push(lk + ': ' + map[k] + '\r\n');
    });
    return lines.join('');
  };
  ReaderLoader.prototype.load = function (
    context: any,
    _config: any,
    callbacks: any,
  ) {
    const url = (context && context.url) || '';
    const rec: LoaderProbe = { url: url.slice(0, 200) };
    probes.push(rec);
    debugLog('Loader GET ' + rec.url);

    const envHash =
      (extraHeaders && extraHeaders['X-Client-Env']) ||
      ((window as any)._avsProbe && (window as any)._avsProbe.envHash) ||
      'f728f44d';
    const headers: Record<string, string> = {
      Referer: referer,
      'X-Client-Env': envHash,
      ...(extraHeaders || {}),
    };

    nativeFetch(url, headers)
      .then(res => {
        rec.status = res.status;
        rec.len = (res.text || '').length;
        rec.note = 'ok';
        if (this._aborted) return;

        const merged: Record<string, string> = { ...(res.headers || {}) };
        if (!merged['content-type'] && !merged['Content-Type']) {
          merged['content-type'] = 'application/vnd.apple.mpegurl; charset=utf-8';
        }
        if (knownHeadersByMatch) {
          for (const rule of knownHeadersByMatch) {
            if (url.indexOf(rule.match) !== -1) {
              Object.keys(rule.headers).forEach(k => {
                const lk = k.toLowerCase();
                if (!merged[lk] && merged[k] == null) {
                  merged[lk] = rule.headers[k];
                  merged[k] = rule.headers[k];
                }
              });
            }
          }
        }

        const normalized = normalizeHeaderMap(merged);
        // pLoader may read these off the inner loader instance.
        this.status = res.status;
        this.headers = normalized;
        this.responseHeaders = normalized;
        this.stats = buildLoaderStats((res.text || '').length || 1);
        this.url = url;
        const body = res.text || '';
        attachResponseBody(this, body);
        attachResponseBody(normalized, body);

        debugLog(
          'Loader hdrKeys=' +
            Object.keys(normalized)
              .map(k => k.toLowerCase())
              .filter((v, i, a) => a.indexOf(v) === i)
              .join(',') +
            ' env=' +
            (normalized['x-envelope'] ? 'yes' : 'no'),
        );

        if (res.status >= 200 && res.status < 300) {
          const body2 = res.text || '';
          const nd = buildNetworkDetails(res.status, url, normalized);
          attachResponseBody(nd, body2);
          attachResponseBody(context, body2);
          const asBuf =
            context &&
            (context.responseType === 'arraybuffer' ||
              context.responseType === 'arrayBuffer');
          // XHR-like body so data.responseText.split works; still has String.split.
          const payload = makeXhrLikeBody(body2, url, normalized);
          if (asBuf) {
            (payload as any).responseArrayBuffer = new TextEncoder().encode(body2).buffer;
          }
          debugLog(
            'Loader onSuccess body len=' +
              body2.length +
              ' responseText=' +
              typeof (payload as any).responseText,
          );
          try {
            callbacks.onSuccess(this.stats, payload, nd, context);
          } catch (e: any) {
            rec.note = String(e && e.message).slice(0, 80);
            debugLog('Loader onSuccess handler threw: ' + rec.note);
            debugLog(
              'Loader stack: ' +
                String((e && e.stack) || '').split('\n').slice(0, 6).join(' | '),
            );
            callbacks.onError(
              { code: 500, message: rec.note, text: rec.note, stack: e && e.stack },
              context,
              nd,
              this.stats,
            );
          }
        } else {
          callbacks.onError(
            { code: res.status, text: 'HTTP ' + res.status },
            context,
            buildNetworkDetails(res.status, url, normalized),
            buildLoaderStats(0),
          );
        }
      })
      .catch((e: any) => {
        rec.note = String(e && e.message).slice(0, 80);
        if (this._aborted) return;
        callbacks.onError(
          { code: 0, text: rec.note, message: rec.note },
          context,
          buildNetworkDetails(0, url, this.headers || {}),
          buildLoaderStats(0),
        );
      });
  };
  ReaderLoader.prototype.abort = function () {
    this._aborted = true;
  };
  ReaderLoader.prototype.destroy = function () {
    //
  };
  return ReaderLoader;
}

/** Debug: log which properties avs pLoader reads before it crashes. */
function spyObject(obj: any, label: string): any {
  try {
    return new Proxy(obj, {
      get(t, p, _r) {
        const key = String(p);
        if (key === 'then' || key === 'toJSON') return (t as any)[p];
        const v = (t as any)[p];
        const kind = typeof v;
        if (kind === 'function') {
          debugLog('spy ' + label + '.' + key + '()');
          return v.bind(t);
        }
        const preview =
          v == null
            ? String(v)
            : typeof v === 'object'
              ? '{' + Object.keys(v).slice(0, 6).join(',') + '}'
              : String(v).slice(0, 48);
        debugLog('spy ' + label + '.' + key + ' = ' + preview);
        return v;
      },
    });
  } catch {
    return obj;
  }
}

/**
 * avs pLoader reads header APIs off the hls.js *context*, not networkDetails:
 *   context.getResponseHeader('…').split(...)
 * If getResponseHeader is missing, that becomes undefined.split.
 */
function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * avs pLoader does context.getResponseHeader('X-Envelope') then
 * something like env.split('.')[1]. The live header is USDK binary
 * base64 (no dots) → parts[1] is undefined → undefined.split.
 * Return a JWT-shaped string whose payload is the envelope JSON.
 */
function shapeEnvelopeHeader(raw: string): string {
  if (!raw) return '';
  try {
    const envJson = parseEnvelope(raw);
    if (envJson && (envJson.cn || envJson.sk)) {
      const jwt = jtiParts((window as any)._avsSk || '');
      const w = window as any;
      const payload = {
        ...envJson,
        // pLoader may read these JWT claims after split('.')[1]
        sub: 'avs-user',
        iss: 'avs-auth',
        jti: jwt ? jwt.jti : '',
        sessionKey: jwt ? jwt.jtiOdd : '',
        sid: w.avsSid || '',
        salt: w._avsSalt || '',
        envHash: (w._avsProbe && w._avsProbe.envHash) || '',
      };
      const enc = b64urlEncode(JSON.stringify(payload));
      return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + enc + '.sig';
    }
  } catch {
    //
  }
  if (raw.indexOf('.') !== -1) return raw;
  return raw;
}

/**
 * pLoader onSuccess may treat `data` as an XHR, not a string:
 *   data.responseText.split('\\n')
 * A raw string has responseText === undefined.
 */
function makeXhrLikeBody(
  body: string,
  url: string,
  headerMap: Record<string, string>,
) {
  const map = normalizeHeaderMap(headerMap);
  const obj: any = new String(body);
  obj.responseText = body;
  obj.response = body;
  obj.body = body;
  obj.data = body;
  obj.status = 200;
  obj.statusText = 'OK';
  obj.responseURL = url;
  obj.responseType = 'text';
  obj.responseHeaders = map;
  obj.headers = map;
  obj.getResponseHeader = function (name: string) {
    if (!name) return '';
    const n = String(name);
    const v = map[n] != null ? map[n] : map[n.toLowerCase()];
    return v != null ? String(v) : '';
  };
  obj.getAllResponseHeaders = function () {
    const seen = new Set<string>();
    const lines: string[] = [];
    Object.keys(map).forEach(k => {
      const lk = k.toLowerCase();
      if (seen.has(lk)) return;
      seen.add(lk);
      lines.push(lk + ': ' + map[k] + '\r\n');
    });
    return lines.join('');
  };
  return obj;
}

function spyString(value: string, tag: string): any {
  const str = String(value == null ? '' : value);
  try {
    return new Proxy(Object(str) as any, {
      get(t, p, _r) {
        if (p === 'split') {
          return function (...args: any[]) {
            const r = (str as any).split(...args);
            debugLog(
              tag +
                '.split(' +
                JSON.stringify(args).slice(0, 40) +
                ') n=' +
                r.length +
                ' [0]=' +
                String(r[0] || '').slice(0, 20) +
                ' [1]=' +
                (r[1] != null ? String(r[1]).slice(0, 24) : 'undefined'),
            );
            return r;
          };
        }
        const v = (t as any)[p];
        return typeof v === 'function' ? v.bind(str) : v;
      },
    });
  } catch {
    return str;
  }
}

function attachContextHeaders(
  context: any,
  headerMap: Record<string, string>,
  status: number,
  url: string,
): any {
  const map = normalizeHeaderMap(headerMap);
  // Pre-shape envelope for JWT-style parse in pLoader.
  const envRaw = map['x-envelope'] || map['X-Envelope'] || '';
  const envShaped = shapeEnvelopeHeader(envRaw);
  if (envShaped && envShaped !== envRaw) {
    map['x-envelope'] = envShaped;
    map['X-Envelope'] = envShaped;
    map['X-Envelope-USDK'] = envRaw;
    debugLog('X-Envelope shaped → jwtish len=' + envShaped.length);
  }

  const lookup = (name: any): string => {
    const n = String(name == null ? '' : name);
    if (!n) {
      debugLog('ctx.getResponseHeader("") → ""');
      return '';
    }
    if (map[n] != null) {
      const v = String(map[n]);
      debugLog(
        'ctx.getResponseHeader("' + n + '") → len=' +
          v.length +
          ' ' +
          v.slice(0, 36) +
          (v.indexOf('.') !== -1 ? '…dotted' : '…'),
      );
      return v;
    }
    const ln = n.toLowerCase();
    if (map[ln] != null) {
      const v = String(map[ln]);
      debugLog('ctx.getResponseHeader("' + n + '") → lc len=' + v.length + ' ' + v.slice(0, 36));
      return v;
    }
    for (const k of Object.keys(map)) {
      const lk = k.toLowerCase();
      if (lk === ln || lk.replace(/-/g, '') === ln.replace(/-/g, '')) {
        const v = String(map[k]);
        debugLog('ctx.getResponseHeader("' + n + '") → ' + k + ' ' + v.slice(0, 36));
        return v;
      }
      if (lk.indexOf(ln) !== -1 || ln.indexOf(lk) !== -1) {
        const v = String(map[k]);
        debugLog('ctx.getResponseHeader("' + n + '") → fuzzy ' + k + ' ' + v.slice(0, 36));
        return v;
      }
    }
    debugLog(
      'ctx.getResponseHeader("' + n + '") → MISSING keys=' +
        Object.keys(map).filter(k => k === k.toLowerCase()).slice(0, 12).join(','),
    );
    return '';
  };

  const api = {
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : String(status),
    url,
    // pLoader does responseURL.split(...) — must never be undefined.
    responseURL: url,
    finalUrl: url,
    headers: map,
    responseHeaders: map,
    // pLoader onSuccess does responseText.split('\n') after reading headers.
    getResponseHeader(name: string): any {
      return spyString(lookup(name), 'hdr[' + String(name) + ']');
    },
    getAllResponseHeaders(): string {
      const seen = new Set<string>();
      const lines: string[] = [];
      Object.keys(map).forEach(k => {
        const lk = k.toLowerCase();
        if (seen.has(lk)) return;
        seen.add(lk);
        const val = String(map[k]);
        lines.push(lk + ': ' + (val.length > 80 ? val.slice(0, 40) + '…' : val) + '\r\n');
      });
      return lines.join('');
    },
  };
  const merged = Object.assign(context || {}, api);
  if (url) {
    debugLog('ctx.responseURL set len=' + String(url).length + ' ' + String(url).slice(0, 50));
  }
  return merged;
}

/** Attach playlist body wherever avs pLoader might read it. */
function attachResponseBody(target: any, body: string): any {
  if (!target || typeof target !== 'object') return target;
  target.responseText = body;
  target.response = body;
  target.body = body;
  target.data = body;
  target.text = body;
  if (!target.status) target.status = 200;
  if (!target.responseURL && target.url) target.responseURL = target.url;
  if (!target.finalUrl && target.url) target.finalUrl = target.url;
  return target;
}

/** XHR-style header APIs on the pLoader *instance* (`this.getResponseHeader`). */
function attachInstanceXhr(
  inst: any,
  headerMap: Record<string, string>,
  body: string,
  url: string,
): void {
  if (!inst || typeof inst !== 'object') return;
  const map = normalizeHeaderMap(headerMap);
  attachResponseBody(inst, body);
  inst.status = inst.status || 200;
  inst.statusText = inst.statusText || 'OK';
  const u = url || inst.url || inst.responseURL || '';
  if (!inst.url && u) inst.url = u;
  // Always stamp responseURL — pLoader does responseURL.split().
  inst.responseURL = u || inst.responseURL || '';
  inst.finalUrl = u || inst.finalUrl || '';
  if (!inst.responseURL) {
    debugLog('attachInstanceXhr: responseURL still empty!');
  }
  inst.headers = map;
  inst.responseHeaders = map;
  // Keep existing logging getResponseHeader if already attached.
  if (typeof inst.getResponseHeader !== 'function') {
    inst.getResponseHeader = function (name: string) {
      if (!name) return '';
      const n = String(name);
      const v = map[n] != null ? map[n] : map[n.toLowerCase()];
      debugLog('inst.getResponseHeader("' + n + '") → ' + (v != null ? String(v).slice(0, 24) : ''));
      return v != null ? String(v) : '';
    };
  }
  if (typeof inst.getAllResponseHeaders !== 'function') {
    inst.getAllResponseHeaders = function () {
      const seen = new Set<string>();
      const lines: string[] = [];
      Object.keys(map).forEach(k => {
        const lk = k.toLowerCase();
        if (seen.has(lk)) return;
        seen.add(lk);
        lines.push(lk + ': ' + map[k] + '\r\n');
      });
      return lines.join('');
    };
  }
}

function invokeLoaderWith(
  LoaderCtor: any,
  InnerLoader: any,
  context: any,
  label: string,
  timeoutMs = 5000,
  hlsConfigExtra?: Record<string, any>,
  preloadBody?: string,
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
      const hlsConfig = {
        loader: InnerLoader,
        pLoader: LoaderCtor,
        xhrSetup: (xhr: any, url: string) => {
          try {
            const eh =
              (hlsConfigExtra && hlsConfigExtra.envHash) ||
              ((window as any)._avsProbe && (window as any)._avsProbe.envHash) ||
              'f728f44d';
            xhr.setRequestHeader('X-Client-Env', eh);
            if (context && context.referer) {
              xhr.setRequestHeader('Referer', context.referer);
            }
          } catch {
            //
          }
        },
        maxRetry: 0,
        timeout: timeoutMs - 400,
        enableWorker: false,
        lowLatencyMode: false,
        ...(hlsConfigExtra || {}),
      };
      const inst = new LoaderCtor(hlsConfig);
      const body =
        preloadBody ||
        (context && context.responseText) ||
        (context && context.text) ||
        (hlsConfigExtra && (hlsConfigExtra as any).preloadBody) ||
        '';
      const hdrMap = normalizeHeaderMap(
        (context && context.headers) ||
          (context && context.responseHeaders) ||
          (hlsConfigExtra && (hlsConfigExtra as any).headers) ||
          {},
      );
      // pLoader reads this.responseText / this.text / this.headers /
      // this.getResponseHeader — stamp the full XHR surface on the instance.
      attachInstanceXhr(inst, hdrMap, body, (context && context.url) || '');
      if (context) {
        attachResponseBody(context, body);
        // Do not clobber logging getResponseHeader on context.
        if (!context.responseURL) context.responseURL = context.url || '';
        if (!context.finalUrl) context.finalUrl = context.url || '';
        context.headers = hdrMap;
        context.responseHeaders = hdrMap;
        if (typeof context.getResponseHeader !== 'function') {
          attachInstanceXhr(context, hdrMap, body, context.url || '');
        } else if (!context.responseURL && context.url) {
          context.responseURL = context.url;
        }
        debugLog(
          'invoke ctx responseURL=' +
            String(context.responseURL || '').slice(0, 50) +
            ' text=' +
            typeof context.text,
        );
      }

      const cb: any = {
        onProgress: () => {
          //
        },
        onError: (err: any, ctx: any, nd: any) => {
          clearTimeout(timer);
          debugLog(
            label +
              ': error ' +
              String(err && (err.message || err.text || err)).slice(0, 80) +
              ' st=' +
              (nd && nd.status),
          );
          done(null);
        },
      };

      cb.onSuccess = (_s: any, data: any, nd: any, ctx: any) => {
        const text0 =
          typeof data === 'string'
            ? data
            : data && typeof data.responseText === 'string'
              ? data.responseText
              : data && typeof data.response === 'string'
                ? data.response
                : body;
        // Re-stamp body onto pLoader instance + callbacks before extract.
        if (text0) {
          try {
            attachResponseBody(inst, text0);
            attachResponseBody(cb, text0);
            if (ctx) attachResponseBody(ctx, text0);
          } catch {
            //
          }
        }
        clearTimeout(timer);
        const urlNow = (ctx && ctx.url) || (context && context.url) || '';
        debugLog(
          label +
            ': success st=' +
            (nd && nd.status) +
            ' body=' +
            (text0 ? text0.length : 0) +
            ' url=' +
            String(urlNow).slice(0, 70),
        );
        if (text0) done(text0);
        else done(null);
      };

      if (body) attachResponseBody(cb, body);

      // If pLoader reads this.responseText inside its own onSuccess wrapper,
      // stamp body on the instance right before load and again after ctor.
      const stamp = (t: string) => {
        if (!t) return;
        attachResponseBody(inst, t);
        attachResponseBody(cb, t);
        try {
          (inst as any)._response = t;
          (inst as any).responseText = t;
          (inst as any).body = t;
          (inst as any).text = t;
          if (!(inst as any).getResponseHeader) {
            attachInstanceXhr(inst, hdrMap, t, (context && context.url) || '');
          }
        } catch {
          //
        }
      };
      stamp(body);

      const origLoad = inst.load && inst.load.bind(inst);
      if (typeof origLoad === 'function') {
        inst.load = function (ctx: any, cfg: any, callbacks: any) {
          const merged = callbacks || cb;
          try {
            const seed =
              (ctx && ctx.responseText) ||
              (merged && merged.responseText) ||
              body;
            stamp(seed);
            if (ctx) attachResponseBody(ctx, seed);
          } catch {
            //
          }
          // Also stamp via wrapped onSuccess if they pass our callbacks through.
          if (merged && merged !== cb && typeof merged.onSuccess === 'function') {
            const inner = merged.onSuccess;
            merged.onSuccess = function (s: any, d: any, n: any, c: any) {
              const t =
                typeof d === 'string'
                  ? d
                  : d && d.responseText
                    ? d.responseText
                    : body;
              stamp(t);
              try {
                return inner.call(this, s, d, n, c);
              } catch (e) {
                // Retry with body-first / response-first argument orders.
                debugLog(label + ': inner onSuccess fail: ' + (e && e.message));
                try {
                  return inner.call(inst, t || '', s, n, c);
                } catch (e2) {
                  try {
                    return inner.call(inst, s, t || '', n, c);
                  } catch (e3) {
                    throw e;
                  }
                }
              }
            };
          }
          return origLoad(ctx, cfg, merged || cb);
        };
      }

      const timer = setTimeout(() => {
        debugLog(label + ': timeout');
        done(null);
      }, timeoutMs);

      inst.load(
        context,
        {
          maxRetry: 0,
          timeout: timeoutMs - 400,
          enableWorker: false,
          lowLatencyMode: false,
        },
        cb,
      );
    } catch (e: any) {
      debugLog(label + ': throw ' + (e && e.message));
      done(null);
    }
  });
}

function finishWithUrls(headerLines: string[], urls: string[]): ResolvedMedia {
  const playable = urls.filter(looksLikeMediaUrl);
  debugLog('Playable media urls: ' + playable.length + '/' + urls.length);
  if (!playable.length) {
    throw new ShieldDecryptUnsupportedError('Không có URL media hợp lệ.');
  }
  return {
    type: 'sources',
    sources: [{ file: buildM3u8Blob(headerLines, playable), type: 'hls' }],
  };
}

async function decryptShieldM3u8(
  m3u8Text: string,
  m3u8Headers: Record<string, string>,
  avsToken: string,
  avsSid: string | null,
  playerUrl: string,
): Promise<ResolvedMedia> {
  const envHeader = m3u8Headers['x-envelope'] || m3u8Headers['x-avs-envelope'] || '';
  const env = envHeader ? parseEnvelope(envHeader) : null;
  const parsed = parsePlaylistSegments(m3u8Text);
  const probeEnv0 =
    (window as any)._avsProbe && (window as any)._avsProbe.envHash;
  let envHash = probeEnv0 || m3u8Headers['x-client-env'] || 'f728f44d';

  debugLog(
    'Shield playlist: segs=' + parsed.segments.length +
      ' key=' + (parsed.keyUrl ? 'yes' : 'no') +
      ' envHash=' + envHash +
      ' hdrKeys=' + Object.keys(m3u8Headers || {}).join(',').slice(0, 120),
  );
  debugLog('envelope=' + (env ? 'ok cn=' + String(env.cn).slice(0, 12) : 'MISSING'));
  if (parsed.segments[0]) {
    debugLog('seg0 fileId=' + parsed.segments[0].fileId + ' i=' + parsed.segments[0].index);
  }

  const expV = ((window as any)._avsExpV as string) || '1.15.7';
  const probes: LoaderProbe[] = [];
  const hashMatch0 = playerUrl.match(/\/player\/([0-9a-f]+)/i);
  const playerId = hashMatch0 ? hashMatch0[1] : '';
  const baseMatch0 = playerUrl.match(/^(https?:\/\/[^/]+)/);
  const baseUrl0 = baseMatch0 ? baseMatch0[1] : '';
  const playlistUrl0 =
    baseUrl0 +
    '/playlist/' +
    playerId +
    '/playlist.m3u8?token=' +
    encodeURIComponent(avsToken);
  const runtime = await loadSiteDecryptRuntime(avsToken, avsSid, expV, {
    playerId,
    playerUrl,
    m3u8Text,
    m3u8Headers,
    playlistUrl: playlistUrl0,
  });
  // _avsProbe.envHash is only set after fingerprint/loader init.
  const probeEnv1 =
    (window as any)._avsProbe && (window as any)._avsProbe.envHash;
  if (probeEnv1 && probeEnv1 !== envHash) {
    debugLog('envHash update ' + envHash + ' → ' + probeEnv1);
    envHash = String(probeEnv1);
  }
  const extraHeaders = { 'X-Client-Env': envHash };
  if (runtime.g6) {
    try {
      debugLog('G6: ' + JSON.stringify(runtime.g6()));
    } catch (e: any) {
      debugLog('G6 err: ' + e.message);
    }
  }
  try {
    const w = window as any;
    debugLog(
      'avsG=' + String(w.avsG || w.__avsG) +
        ' salt=' + w._avsSalt +
        ' sid=' + w.avsSid +
        ' probe=' + JSON.stringify(w._avsProbe),
    );
  } catch (e: any) {
    debugLog('state dump err: ' + e.message);
  }

  const hashMatch = playerUrl.match(/\/player\/([0-9a-f]+)/i);
  const baseMatch = playerUrl.match(/^(https?:\/\/[^/]+)/);
  const baseUrl = baseMatch ? baseMatch[1] : '';
  const playlistUrl =
    baseUrl + '/playlist/' + (hashMatch ? hashMatch[1] : '') +
    '/playlist.m3u8?token=' + encodeURIComponent(avsToken);

  const knownHeadersByMatch = [
    { match: '/playlist/', headers: m3u8Headers },
  ];
  const ReaderLoader = makeReaderLoader(
    probes,
    playerUrl,
    extraHeaders,
    knownHeadersByMatch,
  );

  // 1) pLoader with reader.fetch (real playlist fetch through site wrapper)
  if (runtime.pLoader) {
    debugLog('Invoke pLoader (reader.fetch)…');
    const pLoaderCtx = attachResponseBody(
      attachContextHeaders(
        {
          url: playlistUrl,
          responseType: 'text',
          type: 'manifest',
          level: 0,
          levelurl: playlistUrl,
          referer: playerUrl,
          frag: {
            type: 'playlist',
            level: 0,
            url: playlistUrl,
            relurl: playlistUrl,
            baseurl: baseUrl + '/',
            baseURL: baseUrl + '/',
            base: baseUrl + '/',
            sn: 0,
          },
        },
        m3u8Headers || {},
        200,
        playlistUrl,
      ),
      m3u8Text,
    );
    const viaP = await invokeLoaderWith(
      runtime.pLoader,
      ReaderLoader,
      spyObject(pLoaderCtx, 'ctx'),
      'pLoader',
      6000,
      { envHash, preloadBody: m3u8Text },
      m3u8Text,
    );
    if (viaP) {
      debugLog('pLoader out len=' + viaP.length + ' head=' + viaP.slice(0, 80).replace(/\n/g, '|'));
      const media = extractMediaUrls(viaP);
      if (media.length >= 3 && !isNewShieldPlaylist(viaP)) {
        return finishWithUrls(parsed.headers, media);
      }
      // still shield-shaped → try fLoader on first rewritten chunk-like line
      const lines = viaP.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      if (lines.length && runtime.fLoader) {
        const target = lines.find(l => looksLikeMediaUrl(l)) || lines[0];
        debugLog('pLoader still shield; fLoader on: ' + target.slice(0, 100));
        const viaF = await invokeLoaderWith(
          runtime.fLoader,
          ReaderLoader,
          {
            url: target,
            responseType: 'text',
            frag: { type: 'segment', level: 0, sn: 0, url: target },
          },
          'fLoader-fromP',
          6000,
          { envHash },
        );
        if (viaF && looksLikeM3u8(viaF)) {
          const media2 = extractMediaUrls(viaF);
          if (media2.length) return finishWithUrls(parsed.headers, media2);
        }
      }
    } else {
      debugLog('pLoader returned null — retry arraybuffer body');
      const pLoaderCtxAb = attachResponseBody(
        attachContextHeaders(
          {
            url: playlistUrl,
            responseType: 'arraybuffer',
            type: 'manifest',
            level: 0,
            levelurl: playlistUrl,
            referer: playerUrl,
            frag: {
              type: 'playlist',
              level: 0,
              url: playlistUrl,
              relurl: playlistUrl,
              baseurl: baseUrl + '/',
              baseURL: baseUrl + '/',
              base: baseUrl + '/',
              sn: 0,
            },
          },
          m3u8Headers || {},
          200,
          playlistUrl,
        ),
        m3u8Text,
      );
      const viaP2 = await invokeLoaderWith(
        runtime.pLoader,
        ReaderLoader,
        spyObject(pLoaderCtxAb, 'ctxAb'),
        'pLoader-ab',
        6000,
        { envHash, preloadBody: m3u8Text },
        m3u8Text,
      );
      if (viaP2) {
        debugLog('pLoader-ab out len=' + viaP2.length + ' head=' + viaP2.slice(0, 70).replace(/\n/g, '|'));
        const media = extractMediaUrls(viaP2);
        if (media.length && !isNewShieldPlaylist(viaP2)) {
          return finishWithUrls(parsed.headers, media);
        }
      } else {
        debugLog('pLoader-ab returned null');
      }
    }
  } else {
    debugLog('pLoader missing on window');
  }

  // 2) fLoader directly on first chunk placeholder URL
  if (runtime.fLoader && parsed.segments[0]) {
    const chunkUrl = parsed.segments[0].url;
    debugLog('Invoke fLoader on chunk placeholder…');
    try {
      const buf = await nativeFetchBuffer(chunkUrl, {
        Referer: playerUrl,
        'X-Client-Env': envHash,
      });
      debugLog('Direct chunk fetch st=' + buf.status + ' bytes=' + buf.bytes.length);
    } catch (e: any) {
      debugLog('Direct chunk fetch err: ' + (e && e.message));
    }

    const viaF = await invokeLoaderWith(
      runtime.fLoader,
      ReaderLoader,
      {
        url: chunkUrl,
        responseType: 'arraybuffer',
        frag: {
          type: 'segment',
          level: 0,
          sn: parsed.segments[0].index,
          url: chunkUrl,
        },
      },
      'fLoader-chunk',
      6000,
    );
    if (viaF) {
      const head = viaF.slice(0, 40);
      debugLog('fLoader-chunk out head=' + head.replace(/[^\x20-\x7e]/g, '.'));
      if (looksLikeM3u8(viaF)) {
        const media = extractMediaUrls(viaF);
        if (media.length) return finishWithUrls(parsed.headers, media);
      }
    }
  }

  // 3) site _avsDecryptM3u8 — pass headers shaped the way pLoader reads them
  if (runtime.decrypt) {
    debugLog('Invoke _avsDecryptM3u8…');
    const shapedHeaders = normalizeHeaderMap(m3u8Headers || {});
    const envRaw = shapedHeaders['x-envelope'] || '';
    const envJ = shapeEnvelopeHeader(envRaw);
    if (envJ) {
      shapedHeaders['X-Envelope'] = envJ;
      shapedHeaders['x-envelope'] = envJ;
      shapedHeaders['X-Envelope-USDK'] = envRaw;
    }
    try {
      const dec = await runtime.decrypt(m3u8Text, avsToken, shapedHeaders);
      if (typeof dec === 'string') {
        debugLog('decrypt out len=' + dec.length + ' head=' + dec.slice(0, 70).replace(/\n/g, '|'));
        if (looksLikeM3u8(dec)) {
          const media = extractMediaUrls(dec);
          if (media.length >= 1 && !dec.includes('data:video/mp2t;base64,Rx//EP')) {
            return finishWithUrls(parsed.headers, media);
          }
        }
      }
    } catch (e: any) {
      debugLog('decrypt throw: ' + (e && e.message));
    }
  }

  // 4) pure JS G6-style placeholder decrypt
  if (parsed.segments.length) {
    debugLog('JS placeholder decrypt probe…');
    const urls = await decryptShieldPlaceholders(
      parsed.segments,
      parsed.headers,
      avsToken,
      env,
    );
    if (urls && urls.some(looksLikeMediaUrl)) {
      return finishWithUrls(parsed.headers, urls);
    }
    debugLog('JS placeholder decrypt: no playable urls');
  }

  if (runtime.keysSeen && runtime.keysSeen.length) {
    debugLog('Crypto keys after: ' + runtime.keysSeen.slice(0, 6).join(' | '));
  }
  try {
    if (runtime.g6) debugLog('G6 after: ' + JSON.stringify(runtime.g6()));
  } catch {
    //
  }

  // Reverse path: site scripts may create decrypted m3u8 blobs in our WebView.
  dumpCaptureSummary();
  const captured = collectPlayableFromCapture();
  if (captured) {
    debugLog('Captured playable m3u8 from runtime (' + captured.length + ')');
    const urls = extractMediaUrls(captured);
    if (urls.length) return finishWithUrls(parsed.headers, urls);
    return {
      type: 'sources',
      sources: [{ file: buildM3u8Blob([], captured.split('\n')), type: 'hls' }],
    };
  }

  debugLog('probes=' + JSON.stringify(probes).slice(0, 400));
  throw new ShieldDecryptUnsupportedError(
    'AVS shield v3: không giải mã được m3u8.',
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
    debugLog(
      'Token: ' +
        avsToken.substring(0, 24) +
        '… len=' +
        avsToken.length +
        ' dots=' +
        (avsToken.match(/\./g) || []).length +
        ' sid=' +
        avsSid,
    );

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
    const mediaUrls = extractMediaUrls(m3u8Text);
    if (mediaUrls.length) {
      return {
        type: 'sources',
        sources: [{ file: buildM3u8Blob([], mediaUrls), type: 'hls' }],
      };
    }

    throw new ShieldDecryptUnsupportedError('Playlist không nhận dạng được.');
  } catch (err: any) {
    cleanupIframe(iframe);
    debugLog('Fetch/decrypt fail: ' + err.message);
    throw err;
  }
}
