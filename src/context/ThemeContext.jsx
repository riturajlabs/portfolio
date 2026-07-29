import {
    createContext,
    useEffect,
    useState,
} from "react";


export const ThemeContext = createContext(null);



function ThemeProvider({ children }) {


    const getInitialTheme = () => {

        const savedTheme =
            localStorage.getItem("theme");


        if (savedTheme) {

            return savedTheme;

        }


        // Default portfolio theme
        return "dark";

    };



    const [theme, setTheme] = useState(
        getInitialTheme
    );



    const toggleTheme = () => {

        setTheme((current) =>
            current === "dark"
                ? "light"
                : "dark"
        );

    };



    useEffect(() => {

        const root =
            document.documentElement;


        // Apply theme using CSS variables
        root.setAttribute(
            "data-theme",
            theme
        );


        // Save preference
        localStorage.setItem(
            "theme",
            theme
        );


    }, [theme]);



    return (

        <ThemeContext.Provider

            value={{
                theme,
                toggleTheme,
            }}

        >

            {children}

        </ThemeContext.Provider>

    );

}


export default ThemeProvider;