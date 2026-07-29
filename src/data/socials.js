import {
    FaGithub,
    FaLinkedin,
    FaEnvelope,
} from "react-icons/fa";

import profile from "./profile";

const socials = [
    {
        name: "GitHub",
        url: profile.social.github,
        icon: FaGithub,
    },
    {
        name: "LinkedIn",
        url: profile.social.linkedin,
        icon: FaLinkedin,
    },
    {
        name: "Email",
        url: `mailto:${profile.social.email}`,
        icon: FaEnvelope,
    },
];

export default socials;