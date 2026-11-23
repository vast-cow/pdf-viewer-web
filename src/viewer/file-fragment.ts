export function withFragmentFile(hash: string, path?: string): string {
  const params = new URLSearchParams(hash.startsWith("#?") ? hash.slice(2) : "");
  if (path === undefined) {
    if (!params.has("file")) return hash;
    params.delete("file");
  } else {
    params.set("file", path);
  }
  return params.size ? `#?${params}` : "";
}
