import { motion, useReducedMotion } from "framer-motion";

const defaultVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.4, ease: "easeOut" },
    },
};

export default function Reveal({
    children,
    variants = defaultVariants,
    transition,
    ...props
}) {
    const shouldReduceMotion = useReducedMotion();

    if (shouldReduceMotion) {
        return children;
    }

    return (
        <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px 0px" }}
            variants={variants}
            transition={transition}
            {...props}
        >
            {children}
        </motion.div>
    );
}
