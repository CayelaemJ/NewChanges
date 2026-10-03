import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { MuiProvider } from "./mui-theme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MuiProvider>
      <App />
    </MuiProvider>
  </StrictMode>,
);
