import PropTypes from "prop-types";
import { socials } from "../../lib/publicContent";

function SocialLinks({
    className = "",
    showLabel = true,
    showLabels,
    iconSize = 20,
}) {
    showLabel = showLabels !== undefined ? showLabels : showLabel;
    return (
        <div className={`hero-social ${className}`.trim()}>
            {socials.map((social) => {
                const Icon = social.icon;

                return (
                    <a
                        key={social.name}
                        href={social.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={social.name}
                        title={social.name}
                    >
                        <Icon size={iconSize} />

                        {showLabel && (
                            <span>{social.name}</span>
                        )}
                    </a>
                );
            })}
        </div>
    );
}

SocialLinks.propTypes = {
    className: PropTypes.string,
    showLabel: PropTypes.bool,
    showLabels: PropTypes.bool,
    iconSize: PropTypes.number,
};

export default SocialLinks;