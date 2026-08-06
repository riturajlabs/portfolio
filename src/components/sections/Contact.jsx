import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

import {
    FaEnvelope,
    FaGithub,
    FaLinkedin,
    FaPaperPlane,
    FaCheckCircle,
    FaCopy,
    FaCheck,
} from "react-icons/fa";

import SectionTitle from "../common/SectionTitle";
import { sendEmail } from "../../services/emailService";

import "../../styles/contacts.css";

// ==========================================
// 🛡️ VALIDATION RULES
// ==========================================
const VALIDATION = {
    name: {
        min: 2,
        max: 80,
        pattern: /^[\p{L}\p{N}\s.'\-_]+$/u,
        messages: {
            required: "Please enter your name.",
            tooShort: "Name must be at least 2 characters.",
            tooLong: "Name must be 80 characters or fewer.",
            invalid: "Name contains unsupported characters.",
        },
    },
    email: {
        // Simple but effective — full RFC parsing happens on the backend.
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
        messages: {
            required: "Please enter your email.",
            invalid: "Please enter a valid email address.",
        },
    },
    message: {
        min: 10,
        max: 2000,
        messages: {
            required: "Please enter a message.",
            tooShort: "Message must be at least 10 characters.",
            tooLong: "Message must be 2000 characters or fewer.",
        },
    },
};

function validateField(name, value) {
    const trimmed = (value ?? "").trim();
    const rules = VALIDATION[name];
    if (!rules) return "";

    if (!trimmed) return rules.messages.required;

    if (rules.pattern && !rules.pattern.test(trimmed)) {
        return rules.messages.invalid;
    }
    if (rules.min && trimmed.length < rules.min) {
        return rules.messages.tooShort;
    }
    if (rules.max && trimmed.length > rules.max) {
        return rules.messages.tooLong;
    }
    return "";
}

const initialForm = { name: "", email: "", message: "" };

// ==========================================
// 🧩 FIELD — defined OUTSIDE Contact so React preserves its identity
// across renders. Defining it inside Contact would create a new
// component type on every keystroke, unmounting the <input> and
// stealing focus. (This was the root cause of the focus-loss bug.)
// ==========================================
function Field({
    name,
    label,
    type = "text",
    as = "input",
    formData,
    errors,
    touched,
    onChange,
    onBlur,
    counter,
    ...rest
}) {
    const showError = touched[name] && errors[name];
    const Tag = as;
    const maxLength = VALIDATION[name]?.max ?? undefined;
    return (
        <div className="contact-field">
            <Tag
                type={as === "input" ? type : undefined}
                name={name}
                value={formData[name]}
                onChange={(e) => onChange(name, e.target.value)}
                onBlur={() => onBlur(name)}
                placeholder={label}
                aria-invalid={!!showError}
                aria-describedby={
                    showError ? `contact-error-${name}` : undefined
                }
                maxLength={maxLength}
                required
                {...rest}
            />
            {showError && (
                <span
                    id={`contact-error-${name}`}
                    className="contact-field-error"
                    role="alert"
                >
                    {errors[name]}
                </span>
            )}
            {counter !== undefined && (
                <span className="contact-field-counter">
                    {counter}
                    {maxLength ? `/${maxLength}` : ""}
                </span>
            )}
        </div>
    );
}

function Contact() {
    const [formData, setFormData] = useState(initialForm);
    const [errors, setErrors] = useState({});
    // `touched` tracks which fields the user has interacted with, so we
    // only show validation errors AFTER they leave a field (less noisy).
    const [touched, setTouched] = useState({});
    const [status, setStatus] = useState({ kind: "", text: "" });
    const [loading, setLoading] = useState(false);
    // Honeypot: a hidden field bots tend to fill. If non-empty, silently
    // pretend success without sending the email.
    const [honeypot, setHoneypot] = useState("");
    const [copied, setCopied] = useState("");
    const [shake, setShake] = useState(false);
    const copyTimeoutRef = useRef(null);

    const handleCopyEmail = async (email) => {
        try {
            await navigator.clipboard.writeText(email);
            setCopied(email);
            clearTimeout(copyTimeoutRef.current);
            copyTimeoutRef.current = setTimeout(() => setCopied(""), 2000);
        } catch (error) {
            console.warn("[Contact] Copy failed:", error);
        }
    };

    const contactLinks = useMemo(
        () => [
            {
                icon: <FaEnvelope />,
                title: "Email",
                value: "riturajlabs@outlook.com",
                link: "mailto:riturajlabs@outlook.com",
                copy: "riturajlabs@outlook.com",
            },
            {
                icon: <FaLinkedin />,
                title: "LinkedIn",
                value: "linkedin.com/in/riturajlabs",
                link: "https://linkedin.com/in/riturajlabs",
            },
            {
                icon: <FaGithub />,
                title: "GitHub",
                value: "github.com/riturajlabs",
                link: "https://github.com/riturajlabs",
            },
        ],
        []
    );

    // Stable handlers — using `useCallback` here is optional (Field is
    // now a stable component), but it keeps referential equality tidy
    // and makes the component easier to reason about.
    const updateField = (name, value) => {
        setFormData((prev) => ({ ...prev, [name]: value }));
        // Live-clear an error once the user starts fixing it.
        if (errors[name]) {
            const next = validateField(name, value);
            if (!next) {
                setErrors((prev) => {
                    const rest = { ...prev };
                    delete rest[name];
                    return rest;
                });
            } else {
                setErrors((prev) => ({ ...prev, [name]: next }));
            }
        }
    };

    const handleBlur = (name) => {
        setTouched((prev) => ({ ...prev, [name]: true }));
        const msg = validateField(name, formData[name]);
        setErrors((prev) => (msg ? { ...prev, [name]: msg } : prev));
    };

    async function handleSubmit(e) {
        e.preventDefault();
        if (loading) return;

        // Final validation pass on submit (covers untouched fields).
        const nextErrors = {
            name: validateField("name", formData.name),
            email: validateField("email", formData.email),
            message: validateField("message", formData.message),
        };
        const hasErrors = Object.values(nextErrors).some(Boolean);
        setErrors(nextErrors);
        // Mark every field touched so messages render.
        setTouched({ name: true, email: true, message: true });

        if (hasErrors) {
            setShake(true);
            window.setTimeout(() => setShake(false), 600);
            setStatus({
                kind: "error",
                text: "Please fix the highlighted fields and try again.",
            });
            return;
        }

        // 🐝 Honeypot: if a bot filled the hidden field, pretend success
        // without actually sending. Saves backend quota.
        if (honeypot) {
            setStatus({ kind: "success", text: "Message sent successfully 🚀" });
            setFormData(initialForm);
            setTouched({});
            return;
        }

        setLoading(true);
        setStatus({ kind: "", text: "" });

        try {
            await sendEmail(formData);
            setStatus({
                kind: "success",
                text: "Message sent successfully 🚀",
            });
            setFormData(initialForm);
            setTouched({});
        } catch (error) {
            console.error("[Contact] sendEmail failed:", error);
            setStatus({
                kind: "error",
                text:
                    error?.message ||
                    "Failed to send message. Please email me directly or try again.",
            });
        } finally {
            setLoading(false);
        }
    }

    return (
        <section id="contact" className="contact-section">
            <div className="container">
                <SectionTitle
                    tag="Contact"
                    title="Let's Build Something Together"
                    description="Have an opportunity, project idea, or just want to connect? Feel free to reach out."
                />

                <div className="contact-content">
                    {/* CONTACT INFO */}
                    <motion.div
                        className="contact-info"
                        initial={{ opacity: 0, x: -40 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                    >
                        <h3>Get In Touch</h3>
                        <p>
                            I am open to internship opportunities,
                            collaborations, and interesting technology
                            discussions.
                        </p>

                        <div className="contact-links">
                            {contactLinks.map((item) => (
                                <div
                                    key={item.title}
                                    className="contact-link-row"
                                >
                                    <a
                                        href={item.link}
                                        target={
                                            item.title !== "Email"
                                                ? "_blank"
                                                : undefined
                                        }
                                        rel="noopener noreferrer"
                                    >
                                        <span className="contact-icon">
                                            {item.icon}
                                        </span>
                                        <div>
                                            <h4>{item.title}</h4>
                                            <span>{item.value}</span>
                                        </div>
                                    </a>

                                    {item.copy && (
                                        <button
                                            type="button"
                                            className="contact-copy-btn"
                                            onClick={() =>
                                                handleCopyEmail(item.copy)
                                            }
                                            aria-label={`Copy ${item.title} address`}
                                            title="Copy to clipboard"
                                        >
                                            {copied === item.copy ? (
                                                <FaCheck />
                                            ) : (
                                                <FaCopy />
                                            )}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </motion.div>

                    {/* FORM */}
                    <motion.form
                        className={`contact-form ${shake ? "shake" : ""}`}
                        onSubmit={handleSubmit}
                        initial={{ opacity: 0, x: 40 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        noValidate
                    >
                        <Field
                            name="name"
                            label="Your Name"
                            autoComplete="name"
                            formData={formData}
                            errors={errors}
                            touched={touched}
                            onChange={updateField}
                            onBlur={handleBlur}
                        />
                        <Field
                            name="email"
                            label="Your Email"
                            type="email"
                            autoComplete="email"
                            formData={formData}
                            errors={errors}
                            touched={touched}
                            onChange={updateField}
                            onBlur={handleBlur}
                        />
                        <Field
                            name="message"
                            label="Your Message"
                            as="textarea"
                            rows={5}
                            counter={formData.message.length}
                            formData={formData}
                            errors={errors}
                            touched={touched}
                            onChange={updateField}
                            onBlur={handleBlur}
                        />

                        {/* 🐝 Honeypot: hidden field bots love to fill. */}
                        <div
                            className="contact-honeypot"
                            aria-hidden="true"
                        >
                            <label htmlFor="contact-website">
                                Website
                            </label>
                            <input
                                id="contact-website"
                                type="text"
                                name="website"
                                tabIndex={-1}
                                autoComplete="off"
                                value={honeypot}
                                onChange={(e) =>
                                    setHoneypot(e.target.value)
                                }
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            aria-disabled={loading}
                        >
                            {loading ? "Sending..." : "Send Message"}
                            <FaPaperPlane />
                        </button>

                        {status.text && (
                            <p
                                className={`contact-status contact-status-${status.kind}`}
                                role={status.kind === "error" ? "alert" : "status"}
                            >
                                {status.kind === "success" && (
                                    <FaCheckCircle
                                        aria-hidden="true"
                                        style={{ marginRight: 6 }}
                                    />
                                )}
                                {status.text}
                            </p>
                        )}
                    </motion.form>
                </div>
            </div>

            {/* Copy-to-clipboard toast */}
            {copied && (
                <div className="contact-copy-toast" role="status">
                    <FaCheck aria-hidden="true" />
                    Email copied to clipboard!
                </div>
            )}
        </section>
    );
}

export default Contact;