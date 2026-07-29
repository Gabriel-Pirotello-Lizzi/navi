import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FinanceApp } from "../app/finance-app";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FinanceApp />
  </StrictMode>,
);
