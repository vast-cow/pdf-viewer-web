import { chrome } from "./chrome";

export interface FilePathRequest {
  type: "picked-file-path";
  tabId: number;
  requestId: string;
}

export type FilePathResponse = { path: string } | { error: string };

const permissionMessage = 'Enable “Allow access to file URLs” in the extension’s Chrome settings.';
const lookupMessage = "Chrome couldn’t retrieve the selected file’s path.";

function fileReference(requestId: string): `pdfReaderPickedFile_${string}` {
  return `pdfReaderPickedFile_${requestId}`;
}

export async function getPickedFilePath(file: File): Promise<string> {
  if (!await chrome.extension.isAllowedFileSchemeAccess()) throw new Error(permissionMessage);
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id === undefined) throw new Error("Chrome couldn’t identify this viewer tab.");

  const requestId = crypto.randomUUID();
  const reference = fileReference(requestId);
  const viewer = globalThis as typeof globalThis & Partial<Record<typeof reference, File>>;
  viewer[reference] = file;
  try {
    const response = await chrome.runtime.sendMessage({ type: "picked-file-path", tabId: tab.id, requestId });
    if (!response) throw new Error(lookupMessage);
    if ("error" in response) throw new Error(response.error);
    return response.path;
  } finally {
    delete viewer[reference];
  }
}

export function registerPickedFilePathHandler() {
  const viewerUrl = chrome.runtime.getURL("extension.html");
  const pendingByTab = new Map<number, Promise<FilePathResponse>>();

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "picked-file-path") return;
    const { tabId, requestId } = message;
    if (typeof requestId !== "string" || sender.tab?.id !== tabId || sender.frameId !== 0
        || sender.url?.split(/[?#]/, 1)[0] !== viewerUrl) return;

    // Keep the debugger session in the worker so it can finish even if the viewer reloads.
    const previous = pendingByTab.get(tabId) ?? Promise.resolve();
    const pending = previous.then(() => readPath(tabId, requestId)).catch((error: unknown) => ({
      error: error instanceof Error ? `${lookupMessage} ${error.message}` : lookupMessage,
    }));
    pendingByTab.set(tabId, pending);
    void pending.then(response => {
      if (pendingByTab.get(tabId) === pending) pendingByTab.delete(tabId);
      respond(response);
    });
    return true;
  });

  async function readPath(tabId: number, requestId: string): Promise<FilePathResponse> {
    if (!await chrome.extension.isAllowedFileSchemeAccess()) return { error: permissionMessage };
    const target = { tabId };
    await chrome.debugger.attach(target, "1.3");
    try {
      const { result } = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
        expression: `location.href.split(/[?#]/, 1)[0] === ${JSON.stringify(viewerUrl)}
          ? globalThis[${JSON.stringify(fileReference(requestId))}] : undefined`,
      });
      if (!result?.objectId) return { error: "Chrome couldn’t find the selected file in this viewer tab." };
      const { path } = await chrome.debugger.sendCommand(target, "DOM.getFileInfo", { objectId: result.objectId });
      return path ? { path } : { error: "Chrome didn’t return a path for the selected file." };
    } finally {
      // Closing the tab or dismissing Chrome’s debugger banner may already have detached it.
      await chrome.debugger.detach(target).catch(() => {});
    }
  }
}
