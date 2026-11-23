import { chrome } from "./chrome";

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("extension.html") });
});
