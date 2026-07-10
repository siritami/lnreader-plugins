/* eslint-disable */
/// <reference types="webview" />

const hexToBytes = (hex: string) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
};

const b64Decode = (b64: string) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
};

const decryptM3u8 = async (raw: string, key: string) => {
  let ivHex = '';
  let encryptedData = '';

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('#ENC-AESGCM')) {
      const m = line.match(/iv=([a-fA-F0-9]+)/);
      if (m) ivHex = m[1];
    } else if (line && !line.startsWith('#')) {
      encryptedData = line;
    }
  }

  if (!ivHex || !encryptedData) {
    throw new Error('Định dạng tệp mã hóa không hợp lệ.');
  }

  const isHexKey = key.length === 64 && /^[0-9a-fA-F]+$/.test(key);
  const keyBytes = isHexKey
    ? hexToBytes(key)
    : new TextEncoder().encode(key).slice(0, 32);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(ivHex), tagLength: 128 },
    cryptoKey,
    b64Decode(encryptedData),
  );

  return new TextDecoder().decode(decrypted);
};

const createProxyFragLoader = (origin: string) => {
  return class ProxyFragLoader {
    private _config: any;
    private context: any = null;
    private _controller: AbortController | null = null;
    stats = {
      aborted: false,
      loaded: 0,
      retry: 0,
      total: 0,
      chunkCount: 0,
      bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 },
      parsing: { start: 0, end: 0 },
      buffering: { start: 0, first: 0, end: 0 },
    };

    constructor(config: any) {
      this._config = config;
    }

    destroy() {
      this.abort();
    }

    abort() {
      if (this._controller) {
        this._controller.abort();
        this._controller = null;
      }
    }

    load(ctx: any, _cfg: any, cbs: any) {
      this.context = ctx;
      this.stats.loading.start = performance.now();

      window.reader
        .fetch(ctx.url, {
          method: 'GET',
          headers: { Referer: origin },
          referrer: origin,
        })
        .then(resp => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          this.stats.loading.first = performance.now();
          return resp.arrayBuffer();
        })
        .then(buf => {
          this.stats.loading.end = performance.now();
          this.stats.loaded = buf.byteLength;
          this.stats.total = buf.byteLength;
          cbs.onSuccess({ data: buf }, this.stats, ctx, null);
        })
        .catch(err => {
          if (err.name === 'AbortError') return;
          this.stats.loading.end = performance.now();
          cbs.onError({ code: 0, text: err.message }, ctx, null, this.stats);
        });
    }
  };
};

(async () => {
  const container = document.getElementById('nguonc-player-container');
  if (!container || !window.LNReaderPlayer) return;

  const player = window.LNReaderPlayer;
  player.log('[NGC] customJS loaded, container found');

  const iframeUrl = container.getAttribute('data-iframe');
  const s = container.getAttribute('data-s');
  const k = container.getAttribute('data-k');
  if (!iframeUrl || !s || !k) {
    player.log('[NGC] Missing data attributes');
    return;
  }

  const origin = new URL(iframeUrl).origin;
  const streamUrl = `${origin}/${s}`;

  try {
    // Step 1: POST to get session token (xat)
    player.log('[NGC] POST to get token');
    const tokenRes = await window.reader.fetch(streamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: iframeUrl,
      },
      referrer: iframeUrl,
    });
    const tokenData = await tokenRes.json();
    const xat = tokenData?.xat || '';
    player.log('[NGC] Got xat: ' + (xat ? xat.substring(0, 8) + '...' : 'EMPTY'));

    // Step 2: GET encrypted m3u8 with x-auth header
    player.log('[NGC] GET encrypted m3u8 from: ' + streamUrl);
    const res = await window.reader.fetch(streamUrl, {
      method: 'GET',
      headers: {
        'Referer': iframeUrl,
        'x-auth': xat,
      },
      referrer: iframeUrl,
    });

    player.log('[NGC] GET status: ' + res.status);
    const text = await res.text();
    player.log('[NGC] Response length: ' + text.length);
    const m3u8 = await decryptM3u8(text, k);
    player.log('[NGC] Decrypted m3u8, length: ' + m3u8.length);

    const blob = new Blob([m3u8], { type: 'application/vnd.apple.mpegurl' });
    const url = URL.createObjectURL(blob);

    player.playHls(url, {
      fLoader: createProxyFragLoader(origin),
    });
    player.log('[NGC] playHls called');
  } catch (err: any) {
    player.log('[NGC] Error: ' + (err?.message || err) + ' | name: ' + (err?.name || ''));
  }
})();
