export { ANALYZER_URL } from './analyzer-destination.js';

export function resolveAnalyzerUrl(value, landingOrigin, { allowLocal = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    url.hostname = host;
    // Local links are usable only from a loopback HTTP preview, never a public origin.
    if (allowLocal && !url.username && !url.password && !url.search && !url.hash) {
      const preview = new URL(landingOrigin);
      if (preview.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(preview.hostname) &&
          url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(host) && url.pathname === '/cloud') return url.href;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
    if (!host.includes('.') || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host)) return null;
    if (/(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/.test(host)) return null;
    if (/(?:^|\.)example\.(?:com|net|org)$/.test(host)) return null;
    if (url.origin === landingOrigin) return null;
    return url.href;
  } catch { return null; }
}
