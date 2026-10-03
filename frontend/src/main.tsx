import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { MuiProvider } from "./mui-theme";

const root = document.getElementById("root");

if (!root) {
  throw new Error("React root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <MuiProvider>
      <App />
    </MuiProvider>
  </StrictMode>,
);
