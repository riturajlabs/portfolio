import PropTypes from "prop-types";
import { motion } from "framer-motion";

function SectionTitle({
    tag,
    title,
    description,
    align = "center",
}) {
    return (
        <motion.div
            className={`section-header section-${align}`}
            initial={{
                opacity: 0,
                y: 30,
            }}
            whileInView={{
                opacity: 1,
                y: 0,
            }}
            viewport={{
                once: true,
            }}
            transition={{
                duration: 0.6,
            }}
        >
            {tag && (
                <span className="section-tag">
                    {tag}
                </span>
            )}

            <h2 className="section-title">
                {title}
            </h2>

            {description && (
                <p className="section-description">
                    {description}
                </p>
            )}
        </motion.div>
    );
}

SectionTitle.propTypes = {
    tag: PropTypes.string,
    title: PropTypes.string.isRequired,
    description: PropTypes.string,
    align: PropTypes.oneOf([
        "left",
        "center",
        "right",
    ]),
};

export default SectionTitle;