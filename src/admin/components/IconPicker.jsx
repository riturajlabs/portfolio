// IconPicker — the fixed ADR-008 key vocabulary rendered as a selectable grid.
// Native buttons give keyboard navigation; selection is announced with
// `aria-pressed`. Used for About cards, skill categories and skills.

import { useRef } from "react";

import { ICON_KEYS, AdminIcon } from "../lib/icons.jsx";
import { Field } from "./Form.jsx";

export default function IconPicker({ id, label, value, onChange }) {
  const buttons = useRef([]);

  function handleKeyDown(event, index) {
    const step = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + ICON_KEYS.length) % ICON_KEYS.length;
    buttons.current[next]?.focus();
  }

  return (
    <Field
      label={label || "Icon"}
      htmlFor={id}
      hint="Chosen from the registry (ADR-008). Tab into the grid, use arrow keys to move, then Enter to select. An unknown key is rejected by the server."
    >
      {(fieldId) => (
        <div id={fieldId} className="admin-icon-grid" role="group" aria-label={label || "Icon"}>
          {ICON_KEYS.map((key, index) => (
            <button
              key={key}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              className="admin-icon-option"
              aria-pressed={value === key}
              title={key}
              onKeyDown={(event) => handleKeyDown(event, index)}
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