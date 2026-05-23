export const solveCloudflare = async (
  url: string,
  type: 'interstitial' | 'turnstile' = 'turnstile',
): Promise<boolean> => {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return window.electronAPI.invoke('cloudflare:solve', url, type);
  }
  return false;
};

export const solveCloudflareTurnstile = async (
  url: string,
  sitekey: string,
): Promise<string> => {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return window.electronAPI.invoke(
      'cloudflare:solve-turnstile',
      url,
      sitekey,
    );
  }
  throw new Error('solveCloudflareTurnstile not implemented');
};
