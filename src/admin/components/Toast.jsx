// Toast notifications. Errors use `role="alert"` so assistive tech announces
// them; everything else uses a polite status region.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const ToastContext = createContext(null);

const AUTO_DISMISS_MS = 6000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const timers = useRef(new Set());

  const remove = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((message, variant = "info") => {
    const id = ++nextId.current;
    setToasts((current) => [...current, { id, message, variant }]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      remove(id);
    }, AUTO_DISMISS_MS);
    timers.current.add(timer);
  }, [remove]);

  const dismiss = useCallback((id) => {
    remove(id);
  }, [remove]);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  const api = useMemo(
    () => ({
      info: (message) => push(message, "info"),
      success: (message) => push(message, "success"),
      warn: (message) => push(message, "warning"),
      error: (message) => push(message, "error"),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="admin-toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="admin-toast"
            data-variant={toast.variant}
            role={toast.variant === "error" ? "alert" : "status"}
          >
            <span>{toast.message}</span>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              Close
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>.");
  return ctx;
}