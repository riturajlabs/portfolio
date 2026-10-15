// Form primitives. Every input has an associated `<label>` and inline error
// (`DESIGN_SYSTEM.md` §5); errors announce via `role="alert"`.

import { useId } from "react";

export function Form({ onSubmit, children, className, ...formProps }) {
  return (
    <form
      className={className}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(event);
      }}
      {...formProps}
    >
      {children}
    </form>
  );
}

export function Field({ label, htmlFor, hint, error, required, children }) {
  const autoId = useId();
  const id = htmlFor || autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="admin-field">
      <label className="admin-label" htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </label>
      {children(id, { hintId, errorId })}
      {hint ? (
        <p className="admin-field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="admin-field-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}