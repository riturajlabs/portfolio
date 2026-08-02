import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";

// Tiny subset of Bootstrap: Reboot + container + col-* + display
// utilities. Replaces bootstrap/dist/css/bootstrap.min.css (~230 KB)
// with the ~2 KB actually used. Full bootstrap JS bundle was already
// dropped — it isn't imported here either.
import "./styles/bootstrap-grid-utilities.css";

import "./index.css";

import App from "./App.jsx";
import ThemeProvider from "./context/ThemeContext";


createRoot(document.getElementById("root")).render(

    <StrictMode>

        <HelmetProvider>

            <ThemeProvider>

                <App />

            </ThemeProvider>

        </HelmetProvider>

    </StrictMode>

);