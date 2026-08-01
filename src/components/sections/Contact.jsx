import { useMemo, useState } from "react";
import { motion } from "framer-motion";

import {
    FaEnvelope,
    FaGithub,
    FaLinkedin,
    FaPaperPlane,
    FaCheckCircle,
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
        // Simple but effective — full RFC parsing happens on the EmailJS side.
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

    const contactLinks = [
        {
            icon: <FaEnvelope />,
            title: "Email",
            value: "riturajlabs@outlook.com",
            link: "mailto:riturajlabs@outlook.com",
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
    ];

    // Recompute validity whenever form changes.
    const isValid = useMemo(() => {
        return (
            !validateField("name", formData.name) &&
            !validateField("email", formData.email) &&
            !validateField("message", formData.message)
        );
    }, [formData]);

    function updateField(name, value) {
        setFormData((prev) => ({ ...prev, [name]: value }));
        // Live-clear an error once the user starts fixing it.
        if (errors[name]) {
            const next = validateField(name, value);
            if (!next) {
                setErrors((prev) => {
                    const { [name]: _drop, ...rest } = prev;
                    return rest;
                });
            } else {
                setErrors((prev) => ({ ...prev, [name]: next }));
            }
        }
    }

    function handleBlur(name) {
        setTouched((prev) => ({ ...prev, [name]: true }));
        const msg = validateField(name, formData[name]);
        setErrors((prev) => (msg ? { ...prev, [name]: msg } : prev));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (loading || !isValid) return;

        // 🐝 Honeypot: if a bot filled the hidden field, pretend success
        // without actually sending. Saves EmailJS quota.
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
                text: "Failed to send message. Please email me directly or try again.",
            });
        } finally {
            setLoading(false);
        }
    }

    // Renders a field with inline error display.
    function Field({ name, label, type = "text", as = "input", ...rest }) {
        const showError = touched[name] && errors[name];
        const Tag = as;
        return (
            <div className="contact-field">
                <Tag
                    type={as === "input" ? type : undefined}
                    name={name}
                    value={formData[name]}
                    onChange={(e) => updateField(name, e.target.value)}
                    onBlur={() => handleBlur(name)}
                    placeholder={label}
                    aria-invalid={!!showError}
                    aria-describedby={
                        showError ? `contact-error-${name}` : undefined
                    }
                    maxLength={VALIDATION[name]?.max ?? undefined}
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
            </div>
        );
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
                                <a
                                    key={item.title}
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
                            ))}
                        </div>
                    </motion.div>

                    {/* FORM */}
                    <motion.form
                        className="contact-form"
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
                        />
                        <Field
                            name="email"
                            label="Your Email"
                            type="email"
                            autoComplete="email"
                        />
                        <Field
                            name="message"
                            label="Your Message"
                            as="textarea"
                            rows={5}
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
                            disabled={loading || !isValid}
                            aria-disabled={loading || !isValid}
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
        </section>
    );
}

export default Contact;