import React from "react";
import ReactDOM from "react-dom/client";
import { IconContext } from "@phosphor-icons/react";
import App from "./App";
import "./index.css";

// Kein Rechtsklick-Menü von WebView2 („Neu laden“, „Untersuchen“ …).
// Eigene Rechtsklick-Aktionen der App laufen über onContextMenu weiter.
document.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <IconContext.Provider value={{ weight: "bold" }}>
      <App />
    </IconContext.Provider>
  </React.StrictMode>,
);
