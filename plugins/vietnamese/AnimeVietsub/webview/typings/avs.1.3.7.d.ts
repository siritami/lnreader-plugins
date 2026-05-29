/* eslint-disable */

declare global {
  interface Window {
    _avsCryptoSupported: boolean;
    _avsOnRateLimit?: (retryAfterSeconds: number) => void;
    AvsPlaylistLoader: new (config: LoaderConfig) => AvsPlaylistLoaderInstance;
    AvsEncryptedLoader: new (
      config: LoaderConfig,
    ) => AvsEncryptedLoaderInstance;
    AvsDecryptPlaylist: (url: string) => Promise<string>;
  }

  interface LoaderConfig {
    loader: new (config: any) => BaseLoader;
    [key: string]: any;
  }

  interface BaseLoader {
    stats?: any;
    context?: any;

    abort(): void;
    destroy(): void;

    load(context: any, config: any, callbacks: LoaderCallbacks): void;
  }

  interface LoaderCallbacks {
    onSuccess?: (
      response: LoaderResponse,
      stats?: any,
      context?: any,
      networkDetails?: any,
    ) => void;

    onError?: (
      error: LoaderError,
      context?: any,
      networkDetails?: any,
      stats?: any,
    ) => void;

    [key: string]: any;
  }

  interface LoaderResponse {
    data: string | ArrayBuffer | Uint8Array;
    [key: string]: any;
  }

  interface LoaderError {
    code: number;
    text: string;
  }

  interface AvsPlaylistLoaderInstance {
    readonly stats: any;
    readonly context: any;

    abort(): void;
    destroy(): void;

    load(context: any, config: any, callbacks: LoaderCallbacks): void;
  }

  interface AvsEncryptedLoaderInstance {
    readonly stats: any;
    readonly context: any;

    abort(): void;
    destroy(): void;

    load(context: any, config: any, callbacks: LoaderCallbacks): void;
  }
}

export {};
