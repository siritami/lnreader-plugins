/* eslint-disable */
/// <reference types="webview" />

/**
 * NguonC - WebView Video Player
 *
 * Decrypts AES-GCM m3u8 using HMAC-SHA256 key derivation.
 * Key = HMAC-SHA256(key="stream-derive-v1", data=videoHash)[0:32]
 * Then AES-GCM decrypt with that key + IV.
 */

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



// ── AES-GCM Decryption with HMAC-SHA256 key derivation ──
// Key = HMAC-SHA256(key="stream-derive-v1", data=videoHash)[0:32]

async function decryptM3u8(
  encryptedBytes: Uint8Array,
  ivBytes: Uint8Array,
  videoHash: string,
): Promise<string | null> {
  try {
    const enc = new TextEncoder();
    // Step 1: HMAC-SHA256 with key "stream-derive-v1"
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      enc.encode('stream-derive-v1'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    // Step 2: Sign videoHash → 32-byte digest
    const hmacResult = await crypto.subtle.sign(
      'HMAC',
      hmacKey,
      enc.encode(videoHash),
    );
    // Step 3: First 32 bytes = AES-GCM key
    const aesKey = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(hmacResult).slice(0, 32),
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    // Step 4: AES-GCM decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      aesKey,
      encryptedBytes,
    );
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error('[NGC] Decrypt error:', e);
    return null;
  }
}

// ── Fragment Loader (passes Referer via reader.fetch) ──

function createProxyFragLoader(origin: string) {
  return class {
    stats = { aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0, loading: { start: 0, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 } };
    constructor() {}
    destroy() {}
    abort() {}
    load(ctx: any, _cfg: any, cbs: any) {
      this.stats.loading.start = performance.now();
      window.reader.fetch(ctx.url, { method: 'GET', headers: { Referer: origin }, referrer: origin })
        .then((resp: any) => { if (!resp.ok) throw new Error('HTTP ' + resp.status); this.stats.loading.first = performance.now(); return resp.arrayBuffer(); })
        .then((buf: any) => { this.stats.loading.end = performance.now(); this.stats.loaded = buf.byteLength; this.stats.total = buf.byteLength; cbs.onSuccess({ data: buf }, this.stats, ctx, null); })
        .catch((err: any) => { this.stats.loading.end = performance.now(); cbs.onError({ code: 0, text: err.message }, ctx, null, this.stats); });
    }
  };
}

// ── Main ──

(async () => {
  const player = window.LNReaderPlayer;
  if (!player) return;

  const container = document.getElementById('nguonc-player-container');
  if (!container) {
    player.playIframe('');
    return;
  }

  const embedUrl = container.getAttribute('data-iframe');
  const dataObf = container.getAttribute('data-obf');

  if (!embedUrl || !dataObf) {
    player.playIframe('');
    return;
  }

  try {
    const embedOrigin = new URL(embedUrl).origin;

    // ── 1. Parse data-obf → videoHash ──
    const streamData = JSON.parse(atob(dataObf));
    const streamURL: string = streamData.sUb;
    const videoHash: string = streamData.hD;
    player.log('[NGC] videoHash: ' + videoHash);

    // ── 2. Fetch encrypted m3u8 via reader.fetch ──
    const m3u8Url = `${embedOrigin}/${streamURL}`;
    player.log('[NGC] Fetching encrypted m3u8...');
    const resp = await window.reader.fetch(m3u8Url, { method: 'GET' });
    const encryptedText = await resp.text();
    player.log('[NGC] Got ' + encryptedText.length + ' chars');

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
    player.log('[NGC] IV: ' + ivHex.length + ' hex, data: ' + encryptedBytes.length + ' bytes');

    // ── 4. Decrypt via HMAC-SHA256 key derivation ──
    // Key = HMAC-SHA256(key="stream-derive-v1", data=videoHash)[0:32]
    player.log('[NGC] Decrypting...');
    const m3u8Text = await decryptM3u8(encryptedBytes, ivBytes, videoHash);

    if (!m3u8Text) {
      throw new Error('Decryption failed');
    }

    player.log('[NGC] Decrypted! ' + m3u8Text.length + ' chars');

    // ── 5. Create blob URL and play via hls.js ──
    const blob = new Blob([m3u8Text], { type: 'application/vnd.apple.mpegurl' });
    const blobUrl = URL.createObjectURL(blob);

    player.log('[NGC] Playing via hls.js...');
    player.playHls(blobUrl, {
      fLoader: createProxyFragLoader(embedOrigin),
    });
  } catch (err: any) {
    player.log('[NGC] Error: ' + (err?.message || err));
    player.playIframe(embedUrl || '');
  }
})();
