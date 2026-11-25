import { motion } from "framer-motion";
import { FaMoon, FaSun } from "react-icons/fa";

import useTheme from "../../hooks/useTheme";


function ThemeToggle(){


const {theme,toggleTheme}=useTheme();


// The control is a two-state toggle: `aria-pressed` announces whether
// light mode is currently active, and the label names the action, so
// state is conveyed by more than the icon alone.
const isLight = theme === "light";

const label = isLight ? "Switch to dark theme" : "Switch to light theme";


return (

<motion.button

type="button"

className="theme-toggle"

onClick={toggleTheme}

whileTap={{
scale:.85
}}

whileHover={{
rotate:20
}}

aria-pressed={isLight}

aria-label={label}

title={label}

>


{
isLight
?
<FaMoon aria-hidden="true" />
:
<FaSun aria-hidden="true" />
}


</motion.button>


);


}


export default ThemeToggle;