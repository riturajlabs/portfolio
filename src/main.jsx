import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";

import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";

import "./index.css";

import App from "./App.jsx";
import ThemeProvider from "./context/ThemeContext";


createRoot(document.getElementById("root")).render(

    <HelmetProvider>

        <StrictMode>

            <ThemeProvider>

                <App />

            </ThemeProvider>

        </StrictMode>

    </HelmetProvider>

);