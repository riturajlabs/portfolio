import PropTypes from "prop-types";


function Button({
    children,
    href,
    onClick,
    variant = "primary",
    type = "button",
    target,
    rel,
    className = "",
    disabled = false,
    download,
    ariaLabel,
}) {
    const classes = `btn btn-${variant} ${className}`.trim();

    if (href) {
        return (
            <a
                href={href}
                target={target}
                rel={rel}
                download={download}
                className={classes}
                aria-label={ariaLabel}
            >
                {children}
            </a>
        );
    }

    return (
        <button
            type={type}
            onClick={onClick}
            className={classes}
            disabled={disabled}
            aria-label={ariaLabel}
        >
            {children}
        </button>
    );
}

Button.propTypes = {
    children: PropTypes.node.isRequired,
    href: PropTypes.string,
    onClick: PropTypes.func,
    variant: PropTypes.oneOf([
        "primary",
        "secondary",
        "outline",
        "ghost",
    ]),
    type: PropTypes.oneOf([
        "button",
        "submit",
        "reset",
    ]),
    target: PropTypes.string,
    rel: PropTypes.string,
    className: PropTypes.string,
    disabled: PropTypes.bool,
    download: PropTypes.any,
    ariaLabel: PropTypes.string,
};

export default Button;
