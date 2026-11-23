import { startViewer } from "../viewer/app";
import { preferenceKeys } from "../viewer/preferences";

const prefix = "pdf-reader.";

startViewer({
  async read() {
    return Object.fromEntries(preferenceKeys.map(key => {
      const value = localStorage.getItem(prefix + key);
      return [key, key === "inverted" ? value === "true" : value];
    }));
  },
  async write(key, value) {
    localStorage.setItem(prefix + key, String(value));
  },
});
