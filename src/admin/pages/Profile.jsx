// Profile — site_profile editor: hero content, socials, stats, the about block
// (journey prose + cards) and SEO. All admin field names are snake_case — the
// admin API speaks column names (docs/API.md §6).

import { useCallback, useEffect, useState } from "react";
import { FaPlus, FaTrash } from "react-icons/fa";

import { ApiError, fieldErrorMap, get, put, uploadResume } from "../api/client.js";
import { Field, Form } from "../components/Form.jsx";
import IconPicker from "../components/IconPicker.jsx";
import { useToast } from "../components/Toast.jsx";

// Mirrors the public build's URL rules (`src/lib/content.js`): resume accepts
// an absolute http(s) URL *or* a root-relative path, while the SEO image must be
// an absolute http(s) URL (it becomes a meta `og:image`). Client-side mirrors
// keep a bad value from reaching the API — but never be the only gate.
const HTTP_URL = /^https?:\/\/\S+$/i;

function isValidResume(value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  return HTTP_URL.test(value) || value.startsWith("/");
}

function StringList({ label, values, onChange }) {
  return (
    <Field label={label} hint="One item per line">
      {(id) => (
        <textarea
          id={id}
          className="admin-textarea"
          rows={Math.max(2, values.length + 1)}
          value={values.join("\n")}
          onChange={(event) =>
            onChange(event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))
          }
        />
      )}
    </Field>
  );
}

function RowList({ label, addLabel, children, fields, onAdd, onRemove, onField }) {
  return (
    <div>
      <h3 style={{ marginBottom: "0.5rem" }}>{label}</h3>
      {fields.map((field, index) => (
        <div key={index} style={{ border: "1px solid var(--admin-border)", borderRadius: "var(--admin-radius)", padding: "0.75rem 1rem", marginBottom: "0.75rem" }}>
          {children(field, index, (key, value) => onField(index, key, value))}
          <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => onRemove(index)}>
            <FaTrash aria-hidden="true" /> Remove
          </button>
        </div>
      ))}
      <button type="button" className="admin-btn admin-btn--secondary admin-btn--sm" onClick={onAdd}>
        <FaPlus aria-hidden="true" /> {addLabel}
      </button>
    </div>
  );
}

function orNull(value) {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

// Upload the resume PDF. Unlike the cover-image picker, this is not a staged
// edit: the server stores the object and repoints `site_profile.resume` in one
// audited transaction, so a successful upload *is* the save for the resume. The
// form field is updated with the returned public route (`/api/resume`), and the
// previous resume keeps serving until this call succeeds.
function ResumeUpload({ onUploaded }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function choose(event) {
    const file = event.target.files && event.target.files[0];
    // Clear the input so choosing the *same* file again still fires `change`.
    event.target.value = "";
    if (!file) return;

    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setError("Choose a PDF file.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await uploadResume(file);
      onUploaded(result);
      toast.success("Resume uploaded.");
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field
      label="Upload resume"
      hint="PDF only, up to 10 MB. Stored privately and served at /api/resume."
      error={error}
    >
      {(id, linked) => (
        <input
          id={id}
          type="file"
          accept="application/pdf,.pdf"
          className="admin-input"
          onChange={choose}
          disabled={busy}
          aria-invalid={Boolean(error)}
          aria-describedby={linked.errorId || linked.hintId}
        />
      )}
    </Field>
  );
}

function ProfileSection({ title, open, onToggle, children }) {
  return (
    <section className="admin-card">
      <button
        type="button"
        className="admin-btn admin-btn--ghost"
        aria-expanded={open}
        onClick={onToggle}
      >
        {title} {open ? "▾" : "▸"}
      </button>
      {open ? <div style={{ marginTop: "1rem" }}>{children}</div> : null}
    </section>
  );
}

function ProfileForm({ profile, onSave, saving, fieldErrors }) {
  const [form, setForm] = useState(profile);
  const [status, setStatus] = useState(null);
  const [clientErrors, setClientErrors] = useState({});

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- form buffer mirrors a fresh server copy after each save
    setForm(profile);
    setClientErrors({});
  }, [profile]);

  const patchProfile = (changes) => setForm((current) => ({ ...current, ...changes }));
  const patchSocial = (changes) => setForm((current) => ({ ...current, social: { ...current.social, ...changes } }));
  const patchAbout = (changes) => setForm((current) => ({ ...current, about: { ...current.about, ...changes } }));
  const patchSeo = (changes) => setForm((current) => ({ ...current, seo: { ...current.seo, ...changes } }));
  const patchPerson = (changes) => setForm((current) => ({ ...current, seo: { ...current.seo, person: { ...current.seo.person, ...changes } } }));
  const patchRobots = (changes) => setForm((current) => ({ ...current, seo: { ...current.seo, robots: { ...current.seo.robots, ...changes } } }));
  const patchAddress = (changes) =>
    setForm((current) => ({
      ...current,
      seo: {
        ...current.seo,
        person: {
          ...current.seo.person,
          address: { ...(current.seo.person.address || {}), ...changes },
        },
      },
    }));

  const [activeSection, setActiveSection] = useState(null);

  function toggle(section) {
    setActiveSection((current) => (current === section ? null : section));
  }

  function compile() {
    return {
      name: (form.name || "").trim(),
      title: (form.title || "").trim(),
      greeting: orNull(form.greeting),
      roles: form.roles || [],
      available_for_internship: Boolean(form.available_for_internship),
      internship_text: orNull(form.internship_text),
      description: orNull(form.description),
      location: orNull(form.location),
      resume: (form.resume || "").trim(),
      stats: form.stats || [],
      social: {
        github: (form.social?.github || "").trim(),
        linkedin: (form.social?.linkedin || "").trim(),
        email: (form.social?.email || "").trim(),
      },
      about: {
        tag: (form.about?.tag || "").trim(),
        title: (form.about?.title || "").trim(),
        description: (form.about?.description || "").trim(),
        heading: (form.about?.heading || "").trim(),
        paragraphs: form.about?.paragraphs || [],
        cards: (form.about?.cards || []).map((card) => ({
          icon_key: card.icon_key,
          title: (card.title || "").trim(),
          description: (card.description || "").trim(),
        })),
      },
      seo: {
        siteName: (form.seo?.siteName || "").trim(),
        title: (form.seo?.title || "").trim(),
        description: (form.seo?.description || "").trim(),
        keywords: form.seo?.keywords || [],
        author: (form.seo?.author || "").trim(),
        image: (form.seo?.image || "").trim(),
        imageAlt: (form.seo?.imageAlt || "").trim(),
        twitterCard: (form.seo?.twitterCard || "").trim(),
        twitterSite: orNull(form.seo?.twitterSite),
        locale: (form.seo?.locale || "").trim(),
        type: (form.seo?.type || "").trim(),
        robots: {
          index: Boolean(form.seo?.robots?.index),
          follow: Boolean(form.seo?.robots?.follow),
        },
        person: {
          name: (form.seo?.person?.name || "").trim(),
          alternateName: orNull(form.seo?.person?.alternateName),
          jobTitle: orNull(form.seo?.person?.jobTitle),
          email: orNull(form.seo?.person?.email),
          address: form.seo?.person?.address && (form.seo.person.address.locality || form.seo.person.address.region || form.seo.person.address.country)
            ? {
                locality: (form.seo.person.address.locality || "").trim(),
                region: (form.seo.person.address.region || "").trim(),
                country: (form.seo.person.address.country || "").trim(),
              }
            : null,
          nationality: orNull(form.seo?.person?.nationality),
          credential: orNull(form.seo?.person?.credential),
          knowsAbout: form.seo?.person?.knowsAbout || [],
        },
      },
    };
  }

  async function submit() {
    const body = compile();
    const errors = {};
    if (!body.name.trim()) errors.name = "Name is required.";
    if (!body.title.trim()) errors.title = "Title is required.";
    if (!body.resume.trim()) errors.resume = "Resume path is required.";
    else if (!isValidResume(body.resume)) errors.resume = "Must be an absolute path (start with /) or an http(s) URL.";
    if (body.seo?.image && !HTTP_URL.test(body.seo.image)) {
      errors["seo.image"] = "Must be an absolute http(s) URL — a relative path fails the site build.";
    }
    setClientErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setStatus(null);
    onSave(body, setStatus);
  }

  return (
    <Form onSubmit={submit}>
      {status ? <div className="admin-login-error" role="alert">{status}</div> : null}

      <ProfileSection title="Basics" open={activeSection === "basics"} onToggle={() => toggle("basics")}>
        <Field label="Name" required error={fieldErrors.name || clientErrors.name}>
          {(id, linked) => (
            <input id={id} className="admin-input" value={form.name || ""} onChange={(e) => patchProfile({ name: e.target.value })} aria-invalid={Boolean(fieldErrors.name || clientErrors.name)} aria-describedby={linked.errorId} />
          )}
        </Field>
        <Field label="Title" required error={fieldErrors.title || clientErrors.title}>
          {(id, linked) => (
            <input id={id} className="admin-input" value={form.title || ""} onChange={(e) => patchProfile({ title: e.target.value })} aria-invalid={Boolean(fieldErrors.title || clientErrors.title)} aria-describedby={linked.errorId} />
          )}
        </Field>
        <Field label="Greeting" hint="Hero eyebrow, may contain emoji">
          {(id) => <input id={id} className="admin-input" value={form.greeting || ""} onChange={(e) => patchProfile({ greeting: e.target.value })} />}
        </Field>
        <StringList label="Roles" values={form.roles || []} onChange={(roles) => patchProfile({ roles })} />
        <Field label="Description" hint="Hero paragraph">
          {(id) => <textarea id={id} className="admin-textarea" value={form.description || ""} onChange={(e) => patchProfile({ description: e.target.value })} />}
        </Field>
        <Field label="Location">
          {(id) => <input id={id} className="admin-input" value={form.location || ""} onChange={(e) => patchProfile({ location: e.target.value })} />}
        </Field>
        <Field label="Resume path" required hint="Absolute path (starts with /) or an http(s) URL" error={fieldErrors.resume || clientErrors.resume}>
          {(id, linked) => (
            <input id={id} className="admin-input" value={form.resume || ""} onChange={(e) => patchProfile({ resume: e.target.value })} aria-invalid={Boolean(fieldErrors.resume || clientErrors.resume)} aria-describedby={linked.errorId || linked.hintId} placeholder="/resume.pdf" />
          )}
        </Field>
        <ResumeUpload
          onUploaded={(result) => patchProfile({ resume: result.resume, resume_key: result.key })}
        />
        <div className="admin-checkbox">
          <input id="profile-internship" type="checkbox" checked={Boolean(form.available_for_internship)} onChange={(e) => patchProfile({ available_for_internship: e.target.checked })} />
          <label htmlFor="profile-internship">Available for internship</label>
        </div>
        <Field label="Internship text" hint="Badge label, used when the internship checkbox is on">
          {(id) => <input id={id} className="admin-input" value={form.internship_text || ""} onChange={(e) => patchProfile({ internship_text: e.target.value })} />}
        </Field>
      </ProfileSection>

      <ProfileSection title="Social" open={activeSection === "social"} onToggle={() => toggle("social")}>
        <Field label="GitHub URL">
          {(id) => <input id={id} className="admin-input" value={form.social?.github || ""} onChange={(e) => patchSocial({ github: e.target.value })} autoComplete="off" spellCheck="false" />}
        </Field>
        <Field label="LinkedIn URL">
          {(id) => <input id={id} className="admin-input" value={form.social?.linkedin || ""} onChange={(e) => patchSocial({ linkedin: e.target.value })} autoComplete="off" spellCheck="false" />}
        </Field>
        <Field label="Email">
          {(id) => <input id={id} className="admin-input" type="email" value={form.social?.email || ""} onChange={(e) => patchSocial({ email: e.target.value })} />}
        </Field>
      </ProfileSection>

      <ProfileSection title="Stats" open={activeSection === "stats"} onToggle={() => toggle("stats")}>
        <RowList
          label="Stats"
          addLabel="Add stat"
          fields={form.stats || []}
          onAdd={() => patchProfile({ stats: [...(form.stats || []), { label: "", value: "" }] })}
          onRemove={(index) => patchProfile({ stats: (form.stats || []).filter((_, i) => i !== index) })}
          onField={(index, key, value) =>
            patchProfile({ stats: (form.stats || []).map((stat, i) => (i === index ? { ...stat, [key]: value } : stat)) })
          }
        >
          {(stat, _index, onField) => (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1rem" }}>
              <Field label="Label">
                {(id) => <input id={id} className="admin-input" value={stat.label || ""} onChange={(e) => onField("label", e.target.value)} />}
              </Field>
              <Field label="Value">
                {(id) => <input id={id} className="admin-input" value={stat.value || ""} onChange={(e) => onField("value", e.target.value)} />}
              </Field>
            </div>
          )}
        </RowList>
      </ProfileSection>

      <ProfileSection title="About content" open={activeSection === "about"} onToggle={() => toggle("about")}>
        <Field label="Tag">
          {(id) => <input id={id} className="admin-input" value={form.about?.tag || ""} onChange={(e) => patchAbout({ tag: e.target.value })} />}
        </Field>
        <Field label="Title">
          {(id) => <input id={id} className="admin-input" value={form.about?.title || ""} onChange={(e) => patchAbout({ title: e.target.value })} />}
        </Field>
        <Field label="Description">
          {(id) => <input id={id} className="admin-input" value={form.about?.description || ""} onChange={(e) => patchAbout({ description: e.target.value })} />}
        </Field>
        <Field label="Heading">
          {(id) => <input id={id} className="admin-input" value={form.about?.heading || ""} onChange={(e) => patchAbout({ heading: e.target.value })} />}
        </Field>
        <StringList label="Paragraphs" values={form.about?.paragraphs || []} onChange={(paragraphs) => patchAbout({ paragraphs })} />

        <RowList
          label="About cards"
          addLabel="Add card"
          fields={form.about?.cards || []}
          onAdd={() => patchAbout({ cards: [...(form.about?.cards || []), { icon_key: "FaCode", title: "", description: "" }] })}
          onRemove={(index) => patchAbout({ cards: (form.about?.cards || []).filter((_, i) => i !== index) })}
          onField={(index, key, value) =>
            patchAbout({ cards: (form.about?.cards || []).map((card, i) => (i === index ? { ...card, [key]: value } : card)) })
          }
        >
          {(card, index, onField) => (
            <div>
              <IconPicker id={`about-card-icon-${index}`} label="Icon" value={card.icon_key} onChange={(v) => onField("icon_key", v)} />
              <Field label="Title">
                {(id) => <input id={id} className="admin-input" value={card.title || ""} onChange={(e) => onField("title", e.target.value)} />}
              </Field>
              <Field label="Description">
                {(id) => <textarea id={id} className="admin-textarea" value={card.description || ""} onChange={(e) => onField("description", e.target.value)} />}
              </Field>
            </div>
          )}
        </RowList>
      </ProfileSection>

      <ProfileSection title="Search engine" open={activeSection === "seo"} onToggle={() => toggle("seo")}>
        <Field label="Site name">
          {(id) => <input id={id} className="admin-input" value={form.seo?.siteName || ""} onChange={(e) => patchSeo({ siteName: e.target.value })} />}
        </Field>
        <Field label="SEO title">
          {(id) => <input id={id} className="admin-input" value={form.seo?.title || ""} onChange={(e) => patchSeo({ title: e.target.value })} />}
        </Field>
        <Field label="SEO description">
          {(id) => <textarea id={id} className="admin-textarea" value={form.seo?.description || ""} onChange={(e) => patchSeo({ description: e.target.value })} />}
        </Field>
        <StringList label="Keywords" values={form.seo?.keywords || []} onChange={(keywords) => patchSeo({ keywords })} />
        <Field label="Author">
          {(id) => <input id={id} className="admin-input" value={form.seo?.author || ""} onChange={(e) => patchSeo({ author: e.target.value })} />}
        </Field>
        <Field label="Image" hint="Absolute http(s) URL — becomes the og:image meta tag" error={fieldErrors["seo.image"] || clientErrors["seo.image"]}>
          {(id, linked) => (
            <input id={id} className="admin-input" value={form.seo?.image || ""} onChange={(e) => patchSeo({ image: e.target.value })} aria-invalid={Boolean(fieldErrors["seo.image"] || clientErrors["seo.image"])} aria-describedby={linked.errorId || linked.hintId} placeholder="https://" autoComplete="off" spellCheck="false" />
          )}
        </Field>
        <Field label="Image alt">
          {(id) => <input id={id} className="admin-input" value={form.seo?.imageAlt || ""} onChange={(e) => patchSeo({ imageAlt: e.target.value })} />}
        </Field>
        <Field label="Twitter card">
          {(id) => <input id={id} className="admin-input" value={form.seo?.twitterCard || ""} onChange={(e) => patchSeo({ twitterCard: e.target.value })} />}
        </Field>
        <Field label="Twitter site">
          {(id) => <input id={id} className="admin-input" value={form.seo?.twitterSite || ""} onChange={(e) => patchSeo({ twitterSite: e.target.value })} />}
        </Field>
        <Field label="Locale">
          {(id) => <input id={id} className="admin-input" value={form.seo?.locale || ""} onChange={(e) => patchSeo({ locale: e.target.value })} />}
        </Field>
        <Field label="Type">
          {(id) => <input id={id} className="admin-input" value={form.seo?.type || ""} onChange={(e) => patchSeo({ type: e.target.value })} />}
        </Field>
        <div className="admin-checkbox">
          <input id="seo-index" type="checkbox" checked={Boolean(form.seo?.robots?.index)} onChange={(e) => patchRobots({ index: e.target.checked })} />
          <label htmlFor="seo-index">Allow indexing</label>
        </div>
        <div className="admin-checkbox">
          <input id="seo-follow" type="checkbox" checked={Boolean(form.seo?.robots?.follow)} onChange={(e) => patchRobots({ follow: e.target.checked })} />
          <label htmlFor="seo-follow">Allow following links</label>
        </div>

        <h3 style={{ marginTop: "1rem" }}>Person (schema.org)</h3>
        <Field label="Name">
          {(id) => <input id={id} className="admin-input" value={form.seo?.person?.name || ""} onChange={(e) => patchPerson({ name: e.target.value })} />}
        </Field>
        <Field label="Alternate name">
          {(id) => <input id={id} className="admin-input" value={form.seo?.person?.alternateName || ""} onChange={(e) => patchPerson({ alternateName: e.target.value })} />}
        </Field>
        <Field label="Job title">
          {(id) => <input id={id} className="admin-input" value={form.seo?.person?.jobTitle || ""} onChange={(e) => patchPerson({ jobTitle: e.target.value })} />}
        </Field>
        <Field label="Email">
          {(id) => <input id={id} className="admin-input" type="email" value={form.seo?.person?.email || ""} onChange={(e) => patchPerson({ email: e.target.value })} />}
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "0 1rem" }}>
          <Field label="Locality">
            {(id) => <input id={id} className="admin-input" value={form.seo?.person?.address?.locality || ""} onChange={(e) => patchAddress({ locality: e.target.value })} />}
          </Field>
          <Field label="Region">
            {(id) => <input id={id} className="admin-input" value={form.seo?.person?.address?.region || ""} onChange={(e) => patchAddress({ region: e.target.value })} />}
          </Field>
          <Field label="Country">
            {(id) => <input id={id} className="admin-input" value={form.seo?.person?.address?.country || ""} onChange={(e) => patchAddress({ country: e.target.value })} />}
          </Field>
        </div>
        <Field label="Nationality">
          {(id) => <input id={id} className="admin-input" value={form.seo?.person?.nationality || ""} onChange={(e) => patchPerson({ nationality: e.target.value })} />}
        </Field>
        <Field label="Credential">
          {(id) => <input id={id} className="admin-input" value={form.seo?.person?.credential || ""} onChange={(e) => patchPerson({ credential: e.target.value })} />}
        </Field>
        <StringList label="Knows about" values={form.seo?.person?.knowsAbout || []} onChange={(knowsAbout) => patchPerson({ knowsAbout })} />
      </ProfileSection>

      <button type="submit" className="admin-btn" disabled={saving}>
        {saving ? "Saving…" : "Save profile"}
      </button>
    </Form>
  );
}

export default function Profile() {
  const toast = useToast();
  const [profile, setProfile] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoadError(null);
      setProfile(await get("/profile"));
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount; setState runs after the GET resolves
    refresh();
  }, [refresh]);

  async function save(body, setStatus) {
    setSaving(true);
    setFieldErrors({});
    try {
      await put("/profile", body);
      setStatus(null);
      toast.success("Profile saved.");
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const mapped = fieldErrorMap(err);
        if (Object.keys(mapped).length > 0) {
          setFieldErrors(mapped);
          setStatus("Some fields are invalid — see the errors below the inputs.");
        } else {
          setStatus(err.message);
        }
      } else {
        setStatus(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return <div className="admin-empty" role="alert">{loadError}</div>;
  }
  if (profile === null) {
    return <div className="admin-loading">Loading profile…</div>;
  }

  return <ProfileForm profile={profile} onSave={save} saving={saving} fieldErrors={fieldErrors} />;
}