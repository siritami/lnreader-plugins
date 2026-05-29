/* eslint-disable */

// ./src/lib/reader-mock.ts

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage(message: string): void;
    };

    van: {
      state<T>(initialValue: T): VanState<T>;
      [key: string]: any;
    };

    tts: TTSAPI;

    pageReader: {
      page: VanState<number>;
      totalPages: VanState<number>;
      movePage(page: number): void;
    };

    reader: ReaderAPI;
  }

  interface VanState<T> {
    val: T;
  }

  interface TTSAPI {
    readonly started: boolean;
    readonly reading: boolean;

    start(el?: Element | null): void;
    resume(): void;
    pause(): void;
    stop(): void;
    rewind(): void;
    next(): void;

    seekTo(position: number): void;

    readable(el?: Element | null): void;
    setLoading(loading: boolean): void;
    scrollToElement(el?: Element | null): void;
  }

  interface ReaderAPI {
    readonly novel: {
      name: string;
      [key: string]: any;
    };

    readonly chapter: {
      name: string;
      [key: string]: any;
    };

    readonly nextChapter: any | null;

    readonly autoSaveInterval: number;

    readonly rawHTML: string;

    readonly strings: Record<string, string>;

    readonly chapterElement: HTMLElement;

    readonly viewport: HTMLMetaElement | null;

    readonly selection: Selection | null;

    readonly paddingTop: number;
    readonly layoutHeight: number;
    readonly layoutWidth: number;
    readonly chapterHeight: number;
    readonly chapterWidth: number;

    generalSettings: VanState<Record<string, any>>;
    readerSettings: VanState<Record<string, any>>;
    batteryLevel: VanState<number>;
    hidden: VanState<boolean>;

    post(obj: any): void;

    refresh(): void;

    fetch(url: string, init?: RequestInit): Promise<Response>;
  }
}

export {};
