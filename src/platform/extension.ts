import { startViewer } from "../viewer/app";
import { preferenceKeys } from "../viewer/preferences";
import { chrome } from "./chrome";
import { parseFileFragment } from "./extension-file";
import { getPickedFilePath } from "./extension-picker";

startViewer({
  read: () => chrome.storage.local.get([...preferenceKeys]),
  write: (key, value) => chrome.storage.local.set({ [key]: value }),
}, {
  parse: parseFileFragment,
  getPickedFilePath,
  isAllowedFileSchemeAccess: () => chrome.extension.isAllowedFileSchemeAccess(),
});
