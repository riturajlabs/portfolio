// IconPicker — the fixed ADR-008 key vocabulary rendered as a selectable grid.
// Native buttons give keyboard navigation; selection is announced with
// `aria-pressed`. Used for About cards, skill categories and skills.

import { ICON_KEYS, AdminIcon } from "../lib/icons.jsx";
import { Field } from "./Form.jsx";

export default function IconPicker({ id, label, value, onChange }) {
  return (
    <Field
      label={label || "Icon"}
      htmlFor={id}
      hint="Chosen from the registry (ADR-008). An unknown key is rejected by the server."
    >
      {(fieldId) => (
        <div id={fieldId} className="admin-icon-grid" role="group" aria-label={label || "Icon"}>
          {ICON_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="admin-icon-option"
              aria-pressed={value === key}
              title={key}
              onClick={() => onChange(key)}
            >
              <AdminIcon iconKey={key} />
              <span>{key}</span>
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}