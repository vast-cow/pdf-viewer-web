export function parseFileFragment(hash: string): URL | null | undefined {
  if (!hash.startsWith("#?")) return;
  const value = new URLSearchParams(hash.slice(2)).get("file");
  if (!value) return;

  if (/^[a-z]:[\\/]/i.test(value)) {
    const path = value.slice(3).split(/[\\/]/).map(encodeURIComponent).join("/");
    return new URL(`file:///${value.slice(0, 2)}/${path}`);
  }
  if (value.startsWith("/") && !value.startsWith("//")) {
    const path = value.split("/").map(encodeURIComponent).join("/");
    return new URL(`file://${path}`);
  }

  const url = URL.parse(value);
  if (/^file:\/\/\/(?![/\\])/i.test(value) && url?.protocol === "file:"
      && !url.hostname && !url.pathname.startsWith("//")) return url;
  if (/^https?:\/\/[^/\\]/i.test(value) && url?.hostname && !url.username && !url.password) return url;
  return null;
}
