import { resolveAnalyzerUrl } from './config.js';

export function connectAnalyzerCtas(document, configuredUrl, landingOrigin) {
  const destination = resolveAnalyzerUrl(configuredUrl, landingOrigin, { allowLocal: true });
  if (!destination) return 0;
  let connected = 0;
  for (const button of document.querySelectorAll('button.launch-control')) {
    const link = document.createElement('a');
    link.className = button.className; link.href = destination;
    link.target = '_self'; link.rel = 'noopener noreferrer';
    const descriptionId = button.getAttribute('aria-describedby');
    if (descriptionId) {
      link.setAttribute('aria-describedby', descriptionId);
      const description = document.getElementById(descriptionId);
      if (description) description.textContent = 'Opens the KingdomHaus Deal Scanner in this tab.';
    }
    link.append(...button.childNodes); button.replaceWith(link); connected++;
  }
  return connected;
}
