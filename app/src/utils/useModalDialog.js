import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

// Comportamento de diálogo modal acessível: foco inicial no painel, Tab preso dentro dele,
// Escape fecha (quando não está ocupado) e o foco volta ao elemento que abriu o diálogo.
export function useModalDialog({ onClose, busy = false } = {}) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => { if (previous && typeof previous.focus === 'function') previous.focus(); };
  }, []);

  function onKeyDown(event) {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onClose?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll(FOCUSABLE)];
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return { dialogRef, onKeyDown, dialogProps: { ref: dialogRef, tabIndex: -1, onKeyDown } };
}
