import { motion } from "framer-motion";
import { FaMoon, FaSun } from "react-icons/fa";

import useTheme from "../../hooks/useTheme";


function ThemeToggle(){


const {theme,toggleTheme}=useTheme();



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

aria-label="Theme Toggle"

>


{
theme==="dark"
?
<FaSun/>
:
<FaMoon/>
}


</motion.button>


);


}


export default ThemeToggle;