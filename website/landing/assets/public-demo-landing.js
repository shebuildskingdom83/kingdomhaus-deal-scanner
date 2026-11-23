const analyzerUrl = new URL('./analyzer/', document.baseURI).href;

function openAnalyzer(control) {
  const link = document.createElement('a');
  link.className = control.className;
  link.href = `${analyzerUrl}?guest=1`;
  link.setAttribute('aria-describedby', control.getAttribute('aria-describedby') || '');
  link.append(...control.childNodes);
  control.replaceWith(link);
}

document.querySelectorAll('button.launch-control').forEach(openAnalyzer);
document.querySelectorAll('[data-cloud-auth]').forEach(control => {
  control.removeAttribute('disabled');
  control.addEventListener('click', () => {
    const mode = control.dataset.cloudAuth === 'create' ? '?mode=create' : '';
    window.location.assign(`${analyzerUrl}${mode}`);
  });
});
