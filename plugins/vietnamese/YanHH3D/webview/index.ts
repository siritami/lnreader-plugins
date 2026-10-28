/* eslint-disable @typescript-eslint/no-this-alias */
type Source = {
  label: string;
  src: string;
  /** real m3u8 playlist (resolved by plugin); when present, playHls this */
  resolved?: string;
};

const QUALITY_RE = /\.m3u8(\?|$)/i;

function rankQuality(btn: Source): number {
  const label = (btn.label || '').toLowerCase();
  let score = 0;
  if (btn.resolved || QUALITY_RE.test(btn.src)) score += 1000;
  if (/^4k/.test(label)) score += 400;
  else if (/^1080\+/.test(label)) score += 350;
  else if (/^1080/.test(label)) score += 300;
  else if (/^hd|^720/.test(label)) score += 200;
  else if (/hyd|abyss|link10/.test(label)) score += 10;
  return score;
}

function pickBest(sources: Source[]): Source | null {
  let best: Source | null = null;
  let bestScore = -1;
  for (const s of sources) {
    const sc = rankQuality(s);
    if (sc > bestScore) {
      best = s;
      bestScore = sc;
    }
  }
  return best;
}

void (async () => {
  const reader = window.nekori;
  if (!reader) throw new Error('Reader is unavailable');
  await reader.ready;
  const player = reader.player;
  if (!player) throw new Error('This chapter has no player');

  const container = document.getElementById('yanhh3d-player');
  if (!container) throw new Error('YanHH3D container missing');

  const raw = container.getAttribute('data-sources') || '[]';
  let sources: Source[] = [];
  try {
    sources = JSON.parse(raw);
  } catch {
    sources = [];
  }

  const best = pickBest(sources);
  const fallbackSrc = container.getAttribute('data-best-src') || '';

  const initial: Source | null = best
    ? best
    : fallbackSrc
      ? { label: 'Default', src: fallbackSrc }
      : null;

  async function play(src: Source): Promise<void> {
    const url = src.resolved || src.src;
    if (src.resolved || QUALITY_RE.test(url)) {
      await player.playHls(url, {});
    } else {
      await player.playIframe(url);
    }
  }

  function buildUi(current: Source) {
    const old = document.getElementById('yanhh3d-quality-bar');
    if (old) old.remove();

    const bar = document.createElement('div');
    bar.id = 'yanhh3d-quality-bar';
    bar.style.cssText =
      'position:fixed;bottom:0;left:0;right:0;z-index:9999;display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);font-family:system-ui,sans-serif;';

    const label = document.createElement('span');
    label.textContent = 'Nguồn:';
    label.style.cssText =
      'color:#bbb;font-size:12px;align-self:center;margin-right:4px;';
    bar.appendChild(label);

    const list = sources.length ? sources : [current];
    for (const s of list) {
      const btn = document.createElement('button');
      btn.textContent = s.label || 'Source';
      const active = s.src === current.src;
      btn.style.cssText =
        'padding:6px 12px;font-size:12px;border-radius:4px;border:1px solid ' +
        (active ? '#ff6b35' : '#444') +
        ';background:' +
        (active ? '#ff6b35' : '#222') +
        ';color:' +
        (active ? '#fff' : '#ddd') +
        ';cursor:pointer;';
      btn.onclick = async () => {
        try {
          player.log('[YanHH3D] switch source ' + s.label);
          await play(s);
          buildUi(s);
        } catch (e) {
          player.log('[YanHH3D] switch failed ' + String(e));
        }
      };
      bar.appendChild(btn);
    }
    document.body.appendChild(bar);
  }

  if (!initial) {
    reader.error('YanHH3D: no playable source found');
    return;
  }

  try {
    await play(initial);
    buildUi(initial);
  } catch (e) {
    reader.error('YanHH3D playback failed: ' + String(e));
  }
})().catch(err => window.nekori?.error(String(err)));
