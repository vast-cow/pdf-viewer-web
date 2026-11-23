interface ChromeExtension {
  readonly action: {
    readonly onClicked: { addListener(listener: () => void): void };
  };
  readonly extension: { isAllowedFileSchemeAccess(): Promise<boolean> };
  readonly runtime: { getURL(path: string): string };
  readonly tabs: { create(properties: { url: string }): Promise<unknown> };
  readonly storage: {
    readonly local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}

// Keep the small subset of extension APIs used by the two platform entries here.
export const chrome = (globalThis as typeof globalThis & { chrome: ChromeExtension }).chrome;
