import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

import {
    FaPaperPlane,
    FaCheckCircle,
    FaCopy,
    FaCheck,
} from "react-icons/fa";

import SectionTitle from "../common/SectionTitle";
import { sendEmail } from "../../services/emailService";
import { socials } from "../../lib/publicContent";

import "../../styles/contacts.css";

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
    const id = `contact-${name}`;

    return (
        <div className="contact-field">
            <label htmlFor={id}>{label}</label>
            <Tag
                id={id}
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
    const [touched, setTouched] = useState({});
    const [status, setStatus] = useState({ kind: "", text: "" });
    const [loading, setLoading] = useState(false);
    const [honeypot, setHoneypot] = useState("");
    const [copied, setCopied] = useState("");
    const [shake, setShake] = useState(false);
    const copyTimeoutRef = useRef(null);
    const abortRef = useRef(null);

    useEffect(() => () => {
        abortRef.current?.abort();
        clearTimeout(copyTimeoutRef.current);
    }, []);

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

    const contactLinks = useMemo(() => {
        const byName = Object.fromEntries(
            socials.map((social) => [social.name, social])
        );

        const links = [];

        const email = byName.Email;
        if (email) {
            const address = email.url.replace(/^mailto:/, "");
            links.push({
                icon: <email.icon />,
                title: "Email",
                value: address,
                link: email.url,
                copy: address,
            });
        }

        for (const name of ["LinkedIn", "GitHub"]) {
            const social = byName[name];
            if (!social || !social.url) continue;
            links.push({
                icon: <social.icon />,
                title: name,
                value: social.url.replace(/^https?:\/\//, ""),
                link: social.url,
            });
        }

        return links;
    }, []);

    const updateField = (name, value) => {
        setFormData((prev) => ({ ...prev, [name]: value }));
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

    async function deliver(payload) {
        if (loading) return;

        if (honeypot) {
            setStatus({ kind: "success", text: "Message sent successfully" });
            setFormData(initialForm);
            setTouched({});
            return;
        }

        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        setStatus({ kind: "", text: "" });

        try {
            await sendEmail(payload, { signal: controller.signal });
            setStatus({ kind: "success", text: "Message sent successfully" });
            setFormData(initialForm);
            setTouched({});
            setErrors({});
        } catch (error) {
            if (controller.signal.aborted) {
                setStatus({
                    kind: "info",
                    text: "Sending was cancelled. Your message was not sent.",
                });
            } else {
                setStatus({
                    kind: "error",
                    text:
                        error?.message ||
                        "Failed to send message. Please email me directly or try again.",
                });
            }
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
            setLoading(false);
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (loading) return;

        const nextErrors = {
            name: validateField("name", formData.name),
            email: validateField("email", formData.email),
            message: validateField("message", formData.message),
        };
        const hasErrors = Object.values(nextErrors).some(Boolean);
        setErrors(nextErrors);
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

        await deliver({ ...formData });
    }

    const handleCancel = () => abortRef.current?.abort();
    const handleRetry = () => deliver({ ...formData });

    return (
        <section id="contact" className="contact-section" aria-label="Contact">
            <div className="container">
                <SectionTitle
                    tag="Contact"
                    title="Let's Build Something Together"
                    description="Have an opportunity, project idea, or just want to connect? Feel free to reach out."
                />

                <div className="contact-content">
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
                                                <FaCheck aria-hidden="true" />
                                            ) : (
                                                <FaCopy aria-hidden="true" />
                                            )}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </motion.div>

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

                        <div className="contact-form-actions">
                            <button
                                type="submit"
                                disabled={loading}
                                aria-disabled={loading}
                            >
                                {loading ? "Sending..." : "Send Message"}
                                <FaPaperPlane aria-hidden="true" />
                            </button>

                            {loading && (
                                <button
                                    type="button"
                                    className="contact-cancel-btn"
                                    onClick={handleCancel}
                                >
                                    Cancel
                                </button>
                            )}
                        </div>

                        {status.text && (
                            <div
                                className={`contact-status contact-status-${status.kind}`}
                                role={status.kind === "error" ? "alert" : "status"}
                            >
                                {status.kind === "success" && (
                                    <FaCheckCircle
                                        aria-hidden="true"
                                        style={{ marginRight: 6 }}
                                    />
                                )}
                                <span>{status.text}</span>
                                {status.kind === "error" && (
                                    <button
                                        type="button"
                                        className="contact-retry-btn"
                                        onClick={handleRetry}
                                        disabled={loading}
                                    >
                                        Try again
                                    </button>
                                )}
                                {status.kind === "info" && (
                                    <button
                                        type="button"
                                        className="contact-retry-btn"
                                        onClick={handleRetry}
                                    >
                                        Try again
                                    </button>
                                )}
                                {status.kind === "success" && (
                                    <button
                                        type="button"
                                        className="contact-dismiss-btn"
                                        onClick={() => setStatus({ kind: "", text: "" })}
                                    >
                                        Dismiss
                                    </button>
                                )}
                            </div>
                        )}
                    </motion.form>
                </div>
            </div>

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
