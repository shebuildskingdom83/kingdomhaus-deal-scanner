export function safeBusinessWebsite(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000 || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !host.includes(".") || /^\[|^\d+\./.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) ||
      [...url.searchParams.keys()].some(key => /token|signature|credential|secret/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}
