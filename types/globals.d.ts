interface Window {
  __XLS_NOW?: string | number | Date;
  __feedApp?: {
    state: unknown;
    readonly allLikes: unknown[];
    readonly view: unknown[];
    load(): Promise<void>;
    render(resetScroll?: boolean): void;
    RENDER_DEBOUNCE_MS: number;
    INDEX_REFRESH_MS: number;
    SYNC_RECONCILE_MS: number;
    GALLERY_BATCH_SIZE: number;
  };
  __xlsInjected?: boolean;
}
