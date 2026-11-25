export default function RepeatableGroup({
  id,
  title,
  description,
  addLabel,
  itemName,
  items,
  itemIds = [],
  maxItems,
  onAdd,
  onRemove,
  onMove,
  renderItem,
  groupError,
  emptyText = "None added yet.",
}) {
  const atLimit = items.length >= maxItems;

  function handleKeyDown(event, index) {
    if (!onMove || !event.altKey) return;
    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      onMove(index, index - 1);
    } else if (event.key === "ArrowDown" && index < items.length - 1) {
      event.preventDefault();
      onMove(index, index + 1);
    }
  }

  return (
    <fieldset
      id={id}
      tabIndex={id ? -1 : undefined}
      aria-describedby={groupError && id ? `${id}-error` : undefined}
      className="admin-fieldset case-study-repeatable"
    >
      <legend>{title}</legend>
      {description ? (
        <p className="admin-field-hint case-study-section-description">
          {description}
        </p>
      ) : null}
      <p className="admin-field-hint case-study-repeatable-meta">
        {items.length} of {maxItems} added.
        {onMove
          ? " Use Move up / Move down, or Alt+↑ / Alt+↓, to reorder rows."
          : ""}
      </p>
      {groupError ? (
        <p id={id ? `${id}-error` : undefined} className="admin-field-error" role="alert">
          {groupError}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="case-study-empty-note">{emptyText}</p>
      ) : (
        <div className="case-study-repeatable-list">
          {items.map((item, index) => {
            const rowId = itemIds[index] ?? `${id}-${index}`;
            return (
              <div
                id={rowId}
                className="case-study-repeatable-row"
                key={rowId}
                onKeyDown={(event) => handleKeyDown(event, index)}
              >
                <div className="case-study-repeatable-fields">
                  {renderItem(item, index)}
                </div>
                <div className="case-study-row-actions">
                  {onMove ? (
                    <span
                      className="case-study-repeatable-handle"
                      aria-hidden="true"
                      title="Drag-style handle — use the buttons or Alt+arrow keys to reorder"
                    >
                      ⋮⋮
                    </span>
                  ) : null}
                  {onMove ? (
                    <>
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        aria-label={`Move ${itemName} ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => onMove(index, index - 1)}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        aria-label={`Move ${itemName} ${index + 1} down`}
                        disabled={index === items.length - 1}
                        onClick={() => onMove(index, index + 1)}
                      >
                        Move down
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    id={`${rowId}-remove`}
                    className="admin-btn admin-btn--danger admin-btn--sm"
                    aria-label={`Remove ${itemName} ${index + 1}`}
                    onClick={() => onRemove(index)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        id={id ? `${id}-add` : undefined}
        className="admin-btn admin-btn--secondary admin-btn--sm"
        onClick={onAdd}
        disabled={atLimit}
      >
        {addLabel}
      </button>
    </fieldset>
  );
}
