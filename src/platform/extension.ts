import { startViewer } from "../viewer/app";
import { preferenceKeys } from "../viewer/preferences";
import { chrome } from "./chrome";
import { parseFileFragment } from "./extension-file";

startViewer({
  read: () => chrome.storage.local.get([...preferenceKeys]),
  write: (key, value) => chrome.storage.local.set({ [key]: value }),
}, {
  parse: parseFileFragment,
  isAllowedFileSchemeAccess: () => chrome.extension.isAllowedFileSchemeAccess(),
});
