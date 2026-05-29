/* eslint-disable */

export {};

declare global {
  interface Window {
    _avsCryptoSupported: boolean;

    _avsIsOurWrapper(func: Function): boolean;
    _avsRegisterOurWrapper(func: Function): void;

    _avsMarkKey(key: CryptoKey, meta: AvsKeyMetadata): void;

    _avsBeaconCanary(type: string, data?: Record<string, unknown>): void;

    _avsG6Diag(): {
      hasCrypto: boolean;
      keyCacheSize: string | number;
    };

    _avsDecryptM3u8(
      playlistText: string,
      options?: Record<string, unknown>,
    ): Promise<string>;

    _avsDeriveSegKey(
      sk: BufferSource,
      id: string,
      salt?: BufferSource,
    ): Promise<Uint8Array>;

    _avsDeriveSegIv(
      sk: BufferSource,
      id: string,
      salt?: BufferSource,
    ): Promise<Uint8Array>;

    AvsPlaylistLoader: new (
      config?: Record<string, unknown>,
    ) => AvsPlaylistLoader;

    AvsEncryptedLoader: new (
      config?: Record<string, unknown>,
    ) => AvsEncryptedLoader;
  }

  interface AvsKeyMetadata {
    enable?: boolean;
    permKey?: CryptoKey | BufferSource | null;
    permSalt?: BufferSource | null;
    [key: string]: unknown;
  }

  interface AvsPlaylistLoader {
    stats: Record<string, unknown>;

    load(req: unknown, response: unknown, callbacks: unknown): void;

    abort(): void;
    destroy(): void;
  }

  interface AvsEncryptedLoader {
    load(req: unknown, response: unknown, callbacks: unknown): void;

    abort?(): void;
    destroy?(): void;
  }
}
