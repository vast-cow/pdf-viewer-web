import { startViewer } from "../viewer/app";
import { preferenceKeys } from "../viewer/preferences";
import { chrome } from "./chrome";

startViewer({
  read: () => chrome.storage.local.get([...preferenceKeys]),
  write: (key, value) => chrome.storage.local.set({ [key]: value }),
});
