export async function nativeFetch(
  url: string,
  headers?: Record<string, string>,
): Promise<{ status: number; text: string; headers: Record<string, string> }> {
  const fetchFn =
    window.reader && window.reader.fetch
      ? window.reader.fetch.bind(window.reader)
      : fetch;
  // eslint-disable-next-line
  const init: RequestInit = { credentials: 'include', headers };

  const r = await fetchFn(url, init);
  const h: Record<string, string> = {};
  r.headers.forEach((v, k) => {
    h[k.toLowerCase()] = v;
  });

  const text = await r.text();
  return { status: r.status, text, headers: h };
}

export async function nativeFetchBuffer(
  url: string,
  headers?: Record<string, string>,
): Promise<{
  status: number;
  bytes: Uint8Array;
  headers: Record<string, string>;
}> {
  const fetchFn =
    window.reader && window.reader.fetch
      ? window.reader.fetch.bind(window.reader)
      : fetch;
  // eslint-disable-next-line
  const init: RequestInit = { credentials: 'include', headers };

  const r = await fetchFn(url, init);
  const h: Record<string, string> = {};
  r.headers.forEach((v, k) => {
    h[k.toLowerCase()] = v;
  });

  const buf = await r.arrayBuffer();
  return { status: r.status, bytes: new Uint8Array(buf), headers: h };
}
