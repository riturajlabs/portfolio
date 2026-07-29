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
}) {
    const classes = `btn btn-${variant} ${className}`.trim();

    if (href) {
        return (
            <a
                href={href}
                target={target}
                rel={rel}
                className={classes}
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
};

export default Button;