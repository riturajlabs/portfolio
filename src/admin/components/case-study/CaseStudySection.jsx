export default function CaseStudySection({
  id,
  title,
  description,
  className = "",
  children,
}) {
  const classes = ["admin-fieldset", "case-study-section", className]
    .filter(Boolean)
    .join(" ");

  return (
    <fieldset id={id} tabIndex={id ? -1 : undefined} className={classes}>
      <legend>{title}</legend>
      {description ? (
        <p className="admin-field-hint case-study-section-description">
          {description}
        </p>
      ) : null}
      {children}
    </fieldset>
  );
}
