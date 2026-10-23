import { previews, snapshotFor } from './preview-data.js';
import { paintingCashRemaining } from './cashflow-teaser.js';
import { money } from './cashflow.js';
import { ANALYZER_URL } from './config.js';
import { connectAnalyzerCtas } from './analyzer-launch.js';
import { analysisStages, createAnalysisPlayback } from './analysis-walkthrough.js';

const $ = selector => document.querySelector(selector);
const text = (selector, value) => { const element = $(selector); if (element) element.textContent = value; };
const icons = () => window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true', 'stroke-width': 1.5 } });

function loadPreview(key) {
  if (!Object.hasOwn(previews, key)) return;
  const deal = previews[key], snapshot = snapshotFor(key);
  text('#deal-name', deal.name); text('#deal-id', deal.id);
  text('#deal-location', deal.location); text('#deal-industry', deal.industry);
  text('#preview-selection-status', `${deal.name} selected. ${snapshot.earningsLabel}: ${snapshot.earnings}. Seller-reported figures.`);
  text('#sample-model', deal.model); text('#sample-context', deal.context);
  text('#deal-recommendation', deal.recommendation); text('#clarity-recommendation', deal.recommendation);
  const photo = $('#sample-photo');
  photo.hidden = false;
  photo.width = deal.photoWidth; photo.height = deal.photoHeight;
  photo.srcset = deal.photoSrcset;
  photo.src = `assets/${deal.photo}`; photo.alt = deal.photoAlt;
  const fallback = photo.nextElementSibling;
  if (fallback?.classList.contains('photo-fallback')) fallback.remove();
  for (const field of ['asking', 'revenue', 'earnings', 'ratio', 'note']) text(`#snapshot-${field}`, snapshot[field]);
  text('#asking-label', snapshot.askingLabel); text('#earnings-label', snapshot.earningsLabel);
  text('#ratio-label', snapshot.ratioLabel);
  text('#clarity-positive', deal.positive); text('#clarity-attention', deal.consideration);
  $('#transaction-split').hidden = deal.realEstate === null;
  $('#painting-teaser').hidden = key !== 'painting';
  const questions = $('#preview-questions'); questions.replaceChildren();
  for (const [heading, answer] of deal.questions) {
    const details = document.createElement('details'); details.className = 'preview-question-item';
    const summary = document.createElement('summary'); const label = document.createElement('span');
    label.textContent = heading;
    const plus = document.createElement('i'); plus.dataset.lucide = 'plus'; plus.setAttribute('aria-hidden', 'true');
    const paragraph = document.createElement('p'); paragraph.textContent = answer;
    summary.append(label, plus); details.append(summary, paragraph); questions.append(details);
  }
  const panel = $('.curated-analysis');
  panel.classList.remove('preview-updated');
  requestAnimationFrame(() => panel.classList.add('preview-updated'));
  icons();
}
function showView(value) {
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== value;
}
$('#demo-case').addEventListener('change', event => loadPreview(event.target.value));
document.querySelectorAll('input[name="demo-view"]').forEach(input => input.addEventListener('change', () => showView(input.value)));

function updateCashTeaser() {
  const slider = $('#teaser-owner-range');
  const result = paintingCashRemaining(slider.value);
  text('#teaser-owner', money(Number(slider.value)));
  text('#teaser-annual', money(result));
  slider.setAttribute('aria-valuetext', `${money(Number(slider.value))} annual owner-replacement assumption`);
  $('#teaser-annual').classList.toggle('negative', result !== null && result < 0);
}
$('#teaser-owner-range').addEventListener('input', updateCashTeaser);
updateCashTeaser();

const analysisButton = $('#ai-analysis-trigger');
const analysisReset = $('#ai-analysis-reset');
const analysisPlayback = createAnalysisPlayback({
  reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  onChange({ state, stage }) {
    $('#ai-analysis').dataset.state = state;
    $('#ai-analysis-content').setAttribute('aria-busy', 'false');
    document.querySelectorAll('[data-ai-panel]').forEach(panel => {
      panel.hidden = panel.dataset.aiPanel !== (stage === null ? 'idle' : String(stage));
    });
    document.querySelectorAll('[data-ai-step]').forEach(item => {
      const active = Number(item.dataset.aiStep) === stage;
      if (active) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
      item.querySelector('button').setAttribute('aria-pressed', String(active));
      item.classList.toggle('is-complete', stage !== null && Number(item.dataset.aiStep) < stage);
    });
    analysisButton.disabled = state === 'playing';
    analysisReset.disabled = state === 'idle';
    text('#ai-analysis-trigger span', state === 'complete' || state === 'paused' ? 'Replay Analysis' : 'Preview Analysis');
    text('#ai-analysis-status', state === 'idle' ? 'Analysis walkthrough reset.' :
      `${analysisStages[stage]}. ${state === 'complete' ? 'Walkthrough complete. ' : state === 'paused' ? 'Automatic progression paused. ' : ''}Predefined content; no AI request was made.`);
  }
});
analysisButton.addEventListener('click', () => analysisPlayback.play());
analysisReset.addEventListener('click', () => analysisPlayback.reset());
document.querySelectorAll('[data-ai-stage]').forEach(button => button.addEventListener('click', () => {
  analysisPlayback.select(Number(button.dataset.aiStage));
}));
window.addEventListener('pagehide', () => analysisPlayback.reset());

const menu = $('#menu-toggle');
function closeMenu() {
  $('#nav-links').classList.remove('is-open');
  menu.setAttribute('aria-expanded', 'false'); menu.setAttribute('aria-label', 'Open navigation');
}
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  $('#nav-links').classList.toggle('is-open', open);
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); }
});
document.querySelectorAll('#nav-links a').forEach(link => link.addEventListener('click', () => {
  const wasOpen = menu.getAttribute('aria-expanded') === 'true';
  closeMenu();
  if (wasOpen) { const target = $(link.hash); target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
}));
matchMedia('(min-width: 851px)').addEventListener('change', event => { if (event.matches) closeMenu(); });

connectAnalyzerCtas(document, ANALYZER_URL, location.origin);


document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-step]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  document.querySelectorAll('[data-step-panel]').forEach(panel => { panel.hidden = panel.dataset.stepPanel !== button.dataset.step; });
}));
document.querySelectorAll('input[name="comparison-view"]').forEach(input => input.addEventListener('change', () => {
  document.querySelectorAll('[data-comparison]').forEach(panel => { panel.hidden = panel.dataset.comparison !== input.value; });
  text('#comparison-caption', input.value === 'after' ? 'After: business and included property are separated, with the next transaction questions in view.' : 'Before: a combined asking price and seller claims, with transaction questions still open.');
}));
const scene = $('#depth-scene');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let parallaxFrame = 0;
scene.addEventListener('pointermove', event => {
  if (reducedMotion.matches || !matchMedia('(min-width: 1000px) and (pointer: fine)').matches) return;
  if (parallaxFrame) cancelAnimationFrame(parallaxFrame);
  parallaxFrame = requestAnimationFrame(() => {
    const bounds = scene.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - .5;
    const y = (event.clientY - bounds.top) / bounds.height - .5;
    scene.style.setProperty('--parallax-x', `${x * 8}px`);
    scene.style.setProperty('--parallax-y', `${y * 6}px`);
  });
});
scene.addEventListener('pointerleave', () => {
  cancelAnimationFrame(parallaxFrame);
  scene.style.setProperty('--parallax-x', '0px');
  scene.style.setProperty('--parallax-y', '0px');
});
document.querySelectorAll('img.business-photo').forEach(img => img.addEventListener('error', () => {
  img.hidden = true;
  const fallback = document.createElement('p');
  fallback.className = 'photo-fallback';
  fallback.textContent = 'Business photograph unavailable';
  img.after(fallback);
}, { once: true }));
loadPreview('painting');
if ('IntersectionObserver' in window) {
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.add('motion-ready');
    const reveals = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('is-visible'); reveals.unobserve(entry.target); } }, { threshold: .06 });
    document.querySelectorAll('.reveal').forEach(section => reveals.observe(section));
  }
  const navigation = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) document.querySelectorAll('#nav-links a').forEach(link => {
      if (link.hash === `#${entry.target.id}`) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-5% 0px -60% 0px' });
  document.querySelectorAll('#platform,#how-it-works,#demo,#ai-intelligence,#capabilities').forEach(section => navigation.observe(section));
}
