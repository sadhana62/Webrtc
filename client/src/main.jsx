import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";
import { SocketProvider } from "./contexts/SocketContext.jsx";
import { PeerProvider } from "./contexts/PeerContext.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SocketProvider>
      <PeerProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </PeerProvider>
    </SocketProvider>
  </React.StrictMode>,
);
