export function b64urlDecode(str: string): Uint8Array {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  s += '=='.slice(0, (4 - (s.length % 4)) % 4);
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function lcgNext(state: number): number {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

export function deriveSeed(sk: string): number {
  return (parseInt(sk.substring(0, 8), 16) || 0) >>> 0;
}

export function stringUnshuffle(str: string, seed: string): string {
  const chars = str.split('');
  const len = chars.length;
  let state = deriveSeed(seed);
  const swaps: number[][] = [];
  for (let i = len - 1; i > 0; i--) {
    state = lcgNext(state);
    swaps.push([i, state % (i + 1)]);
  }
  for (let k = swaps.length - 1; k >= 0; k--) {
    const a = swaps[k][0];
    const b = swaps[k][1];
    const tmp = chars[a];
    chars[a] = chars[b];
    chars[b] = tmp;
  }
  return chars.join('');
}

export function createPRNG(seed: string): () => number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash ^ (seed.charCodeAt(i) & 255)) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let state = hash >>> 0 || 1;
  return function () {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state >>>= 0;
    state ^= state << 5;
    return (state >>>= 0);
  };
}

export function descramble(
  data: Uint8Array | ArrayBuffer,
  permKey: string,
  permSalt: string,
): ArrayBuffer {
  const input = data instanceof Uint8Array ? data : new Uint8Array(data);
  const len = input.length;
  const output = new Uint8Array(len);
  if (len === 0) return output.buffer;
  const rng = createPRNG(permKey + '|' + permSalt);
  const perm = new Uint32Array(len);
  for (let i = 0; i < len; i++) perm[i] = i;
  for (let i = len - 1; i > 0; i--) {
    const j = rng() % (i + 1);
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  let xorState = 0;
  for (let i = 0; i < len; i++) {
    if (!(i & 3)) xorState = rng();
    output[perm[i]] = input[i] ^ ((xorState >>> (8 * (i & 3))) & 255);
  }
  return output.buffer;
}
