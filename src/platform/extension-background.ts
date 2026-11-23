import { chrome } from "./chrome";
import { registerPickedFilePathHandler } from "./extension-picker";

registerPickedFilePathHandler();

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("extension.html") });
});
