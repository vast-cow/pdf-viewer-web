import type { FilePathRequest, FilePathResponse } from "./extension-picker";

type Debuggee = { tabId: number };

interface ChromeExtension {
  readonly action: {
    readonly onClicked: { addListener(listener: () => void): void };
  };
  readonly debugger: {
    attach(target: Debuggee, requiredVersion: string): Promise<void>;
    detach(target: Debuggee): Promise<void>;
    sendCommand(target: Debuggee, method: "Runtime.evaluate", params: { expression: string }):
      Promise<{ result?: { objectId?: string } }>;
    sendCommand(target: Debuggee, method: "DOM.getFileInfo", params: { objectId: string }):
      Promise<{ path?: string }>;
  };
  readonly extension: { isAllowedFileSchemeAccess(): Promise<boolean> };
  readonly runtime: {
    getContexts(filter: { documentIds: string[]; tabIds: number[]; frameIds: number[] }): Promise<unknown[]>;
    getURL(path: string): string;
    sendMessage(message: FilePathRequest): Promise<FilePathResponse | undefined>;
    readonly onMessage: {
      addListener(listener: (
        message: FilePathRequest, sender: { tab?: { id?: number }; url?: string; frameId?: number; documentId?: string },
        respond: (response: FilePathResponse) => void,
      ) => true | undefined): void;
    };
  };
  readonly tabs: {
    create(properties: { url: string }): Promise<unknown>;
    getCurrent(): Promise<{ id?: number } | undefined>;
  };
  readonly storage: {
    readonly local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}

// Keep the small subset of extension APIs used by the two platform entries here.
export const chrome = (globalThis as typeof globalThis & { chrome: ChromeExtension }).chrome;
