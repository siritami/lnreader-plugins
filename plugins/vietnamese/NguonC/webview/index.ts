/* eslint-disable */
/// <reference types="webview" />

/**
 * NguonC - WebView Video Player
 *
 * Fetches encrypted m3u8 via reader.fetch (bypasses CORS),
 * decrypts AES-GCM with PBKDF2-derived key, plays via playHls.
 */

// ── Helpers ──

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

const textToBytes = (s: string) => new TextEncoder().encode(s);

// ── Fragment Loader ──

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
        .then((resp: any) => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          this.stats.loading.first = performance.now();
          return resp.arrayBuffer();
        })
        .then((buf: any) => {
          this.stats.loading.end = performance.now();
          this.stats.loaded = buf.byteLength;
          this.stats.total = buf.byteLength;
          cbs.onSuccess({ data: buf }, this.stats, ctx, null);
        })
        .catch((err: any) => {
          if (err.name === 'AbortError') return;
          this.stats.loading.end = performance.now();
          cbs.onError({ code: 0, text: err.message }, ctx, null, this.stats);
        });
    }
  };
};

// ── AES-GCM Decryption with PBKDF2 key derivation ──

async function tryDecrypt(
  encryptedBytes: Uint8Array,
  ivBytes: Uint8Array,
  password: string,
  salt: Uint8Array,
  iterations: number,
  hash: string,
): Promise<string | null> {
  try {
    // Import raw password as PBKDF2 key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      textToBytes(password),
      'PBKDF2',
      false,
      ['deriveKey'],
    );

    // Derive AES-GCM key via PBKDF2
    const aesKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash,
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      aesKey,
      encryptedBytes,
    );

    const text = new TextDecoder().decode(decrypted);
    if (text.includes('#EXTINF') || text.includes('#EXTM3U')) {
      return text;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Main ──

(async () => {
  console.log('[NGC] Webview script loaded');
  const player = window.LNReaderPlayer;
  if (!player) return;

  const container = document.getElementById('nguonc-player-container');
  if (!container) return;

  const embedUrl = container.getAttribute('data-iframe');
  const dataObf = container.getAttribute('data-obf');

  if (!embedUrl || !dataObf) {
    player.log('[NGC] Missing data attributes');
    return;
  }

  try {
    const embedOrigin = new URL(embedUrl).origin;

    // ── 1. Parse data-obf to get streamURL + key material ──
    const streamData = JSON.parse(atob(dataObf));
    const streamURL: string = streamData.sUb; // base64({h, t})
    const videoHash: string = streamData.hD;

    // Decode inner JSON to get the hex key
    const innerData = JSON.parse(atob(streamURL));
    const hexKey: string = innerData.t; // 64-char hex
    const hash: string = innerData.h; // same as videoHash

    player.log('[NGC] videoHash: ' + videoHash);
    player.log('[NGC] hexKey: ' + hexKey);

    // ── 2. Fetch encrypted m3u8 via reader.fetch ──
    const m3u8Url = `${embedOrigin}/${streamURL}`;
    player.log('[NGC] GET encrypted m3u8...');
    const resp = await window.reader.fetch(m3u8Url, { method: 'GET' });
    const encryptedText = await resp.text();
    player.log('[NGC] Got ' + encryptedText.length + ' chars');
    player.log('[NGC] Preview: ' + encryptedText.substring(0, 150));

    // ── 3. Parse #ENC-AESGCM header ──
    let ivHex = '';
    let encryptedData = '';
    for (const line of encryptedText.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#ENC-AESGCM')) {
        const m = trimmed.match(/iv=([a-fA-F0-9]+)/);
        if (m) ivHex = m[1];
      } else if (trimmed && !trimmed.startsWith('#')) {
        encryptedData = trimmed;
      }
    }

    if (!ivHex || !encryptedData) {
      throw new Error('Invalid encrypted m3u8 format');
    }

    const ivBytes = hexToBytes(ivHex);
    const encryptedBytes = b64Decode(encryptedData);
    player.log(
      '[NGC] IV: ' +
        ivHex.length +
        ' hex, encrypted: ' +
        encryptedBytes.length +
        ' bytes',
    );

    // ── 4. Try PBKDF2 decryption with brute-force parameters ──
    // Common passwords: hexKey, videoHash
    // Common salts: hexKey bytes, videoHash bytes, empty, hexKey-as-hex-bytes
    const passwords = [hexKey, videoHash];
    const iterationsList = [1, 100, 1000, 10000, 100000];
    const hashAlgos: Array<{ name: string; label: string }> = [
      { name: 'SHA-1', label: 'SHA-1' },
      { name: 'SHA-256', label: 'SHA-256' },
      { name: 'SHA-384', label: 'SHA-384' },
      { name: 'SHA-512', label: 'SHA-512' },
    ];

    // Salt candidates
    const saltCandidates: Array<{ name: string; bytes: Uint8Array }> = [
      { name: 'hexKey', bytes: hexToBytes(hexKey) },
      { name: 'hexKey-text', bytes: textToBytes(hexKey) },
      { name: 'videoHash', bytes: hexToBytes(videoHash) },
      { name: 'videoHash-text', bytes: textToBytes(videoHash) },
      { name: 'empty', bytes: new Uint8Array(0) },
    ];

    // Try direct hex key (no PBKDF2) first
    player.log('[NGC] Trying direct hex key...');
    const directKeyBytes = hexToBytes(hexKey);
    try {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        directKeyBytes,
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
      );
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes },
        cryptoKey,
        encryptedBytes,
      );
      const text = new TextDecoder().decode(decrypted);
      if (text.includes('#EXTINF') || text.includes('#EXTM3U')) {
        player.log('[NGC] Decrypted with direct key!');
        playDecryptedM3u8(text, embedOrigin, player);
        return;
      }
    } catch {
      // Try with 32-byte truncated key
      try {
        const key32 = directKeyBytes.slice(0, 32);
        const cryptoKey = await crypto.subtle.importKey(
          'raw',
          key32,
          { name: 'AES-GCM' },
          false,
          ['decrypt'],
        );
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: ivBytes },
          cryptoKey,
          encryptedBytes,
        );
        const text = new TextDecoder().decode(decrypted);
        if (text.includes('#EXTINF') || text.includes('#EXTM3U')) {
          player.log('[NGC] Decrypted with truncated key!');
          playDecryptedM3u8(text, embedOrigin, player);
          return;
        }
      } catch {}
    }

    // Try PBKDF2 combinations
    let totalAttempts = 0;
    for (const pw of passwords) {
      for (const salt of saltCandidates) {
        for (const iter of iterationsList) {
          for (const hashAlgo of hashAlgos) {
            totalAttempts++;
            const result = await tryDecrypt(
              encryptedBytes,
              ivBytes,
              pw,
              salt.bytes,
              iter,
              hashAlgo.name,
            );
            if (result) {
              player.log(
                `[NGC] Decrypted! pw=${pw.substring(0, 8)}... salt=${salt.name} iter=${iter} hash=${hashAlgo.label}`,
              );
              playDecryptedM3u8(result, embedOrigin, player);
              return;
            }
          }
        }
      }
    }

    // Also try HMAC-SHA256 derived key (like AnimeVietsub)
    player.log('[NGC] Trying HMAC-SHA256 derived key...');
    for (const pw of passwords) {
      try {
        const keyMaterial = await crypto.subtle.importKey(
          'raw',
          textToBytes(pw),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
        const gcmKeyBuf = await crypto.subtle.sign(
          'HMAC',
          keyMaterial,
          textToBytes(videoHash),
        );
        const gcmKey = await crypto.subtle.importKey(
          'raw',
          gcmKeyBuf,
          { name: 'AES-GCM' },
          false,
          ['decrypt'],
        );
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: ivBytes },
          gcmKey,
          encryptedBytes,
        );
        const text = new TextDecoder().decode(decrypted);
        if (text.includes('#EXTINF') || text.includes('#EXTM3U')) {
          player.log('[NGC] Decrypted with HMAC-SHA256 derived key!');
          playDecryptedM3u8(text, embedOrigin, player);
          return;
        }
      } catch {}
    }

    // Try AES-CBC instead of AES-GCM
    player.log('[NGC] Trying AES-CBC...');
    for (const pw of passwords) {
      const keyBytes = hexToBytes(pw);
      for (const len of [16, 32]) {
        try {
          const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyBytes.slice(0, len),
            { name: 'AES-CBC' },
            false,
            ['decrypt'],
          );
          const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-CBC', iv: ivBytes },
            cryptoKey,
            encryptedBytes,
          );
          const text = new TextDecoder().decode(decrypted);
          if (text.includes('#EXTINF') || text.includes('#EXTM3U')) {
            player.log('[NGC] Decrypted with AES-CBC!');
            playDecryptedM3u8(text, embedOrigin, player);
            return;
          }
        } catch {}
      }
    }

    player.log(
      '[NGC] All ' +
        totalAttempts +
        ' decryption attempts failed. Falling back to iframe.',
    );
    player.playIframe(embedUrl);
  } catch (err: any) {
    player.log('[NGC] Error: ' + (err?.message || err));
    if (embedUrl) player.playIframe(embedUrl);
  }
})();

function playDecryptedM3u8(
  m3u8Text: string,
  origin: string,
  player: any,
) {
  player.log('[NGC] Playing decrypted m3u8 (' + m3u8Text.length + ' chars)');
  const blob = new Blob([m3u8Text], {
    type: 'application/vnd.apple.mpegurl',
  });
  const url = URL.createObjectURL(blob);
  player.playHls(url, {
    fLoader: createProxyFragLoader(origin),
  });
  player.log('[NGC] playHls called');
}
