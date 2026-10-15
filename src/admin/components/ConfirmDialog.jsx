// Accessible confirmation modal: focus trap, Escape to cancel, `alertdialog`
// semantics (DESIGN_SYSTEM.md §5 — modals need a focus trap + Escape to close).

import { useEffect, useId, useRef } from "react";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function ConfirmDialog({
  open,
  title = "Are you sure?",
  message,
  confirmLabel = "Delete",
  onCancel,
  onConfirm,
  children,
}) {
  const titleId = useId();
  const firstButtonRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const dialog = dialogRef.current;
    firstButtonRef.current?.focus();

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusables = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter(
        (el) => !el.hasAttribute("disabled"),
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="admin-modal-backdrop">
      <div
        ref={dialogRef}
        className="admin-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId}>{title}</h2>
        {message ? <p>{message}</p> : null}
        {children}
        <div className="admin-modal-actions">
          <button
            ref={firstButtonRef}
            type="button"
            className="admin-btn admin-btn--secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="button" className="admin-btn admin-btn--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}