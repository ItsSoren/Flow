(() => {
  'use strict';
  const dialogs = [...document.querySelectorAll('.modal-backdrop[role="dialog"]')];
  const opened = new Map();
  let outsideFocus = document.activeElement;
  const visible = element => !element.classList.contains('hidden');
  const controls = dialog => [...dialog.querySelectorAll('button, input:not([type="hidden"]), select, textarea, a[href], summary, [tabindex]')]
    .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
  const top = () => [...opened.keys()].filter(visible).at(-1);
  document.addEventListener('focusin', event => {
    if (!dialogs.some(dialog => dialog.contains(event.target))) outsideFocus = event.target;
  });
  const observer = new MutationObserver(() => {
    for (const dialog of dialogs) {
      if (visible(dialog) && !opened.has(dialog)) {
        opened.set(dialog, outsideFocus);
        if (!dialog.contains(document.activeElement)) {
          dialog.tabIndex = -1;
          (controls(dialog)[0] || dialog).focus({ preventScroll: true });
        }
      } else if (!visible(dialog) && opened.has(dialog)) {
        const previous = opened.get(dialog);
        opened.delete(dialog);
        const remaining = top();
        if (remaining) (controls(remaining)[0] || remaining).focus({ preventScroll: true });
        else if (previous?.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
      }
    }
  });
  dialogs.forEach(dialog => observer.observe(dialog, { attributes: true, attributeFilter: ['class'] }));
  document.addEventListener('keydown', event => {
    const dialog = top();
    if (!dialog || event.key !== 'Tab') return;
    const items = controls(dialog), first = items[0], last = items.at(-1);
    if (!items.length) { event.preventDefault(); dialog.focus(); return; }
    if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    }
  }, true);
})();
