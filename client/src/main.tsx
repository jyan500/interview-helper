import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./store";
import App from "./App";
import "./index.css"; // pulls in Tailwind's generated utilities

// <Provider> makes the Redux store — and therefore the RTK Query cache and hooks —
// available to every component in the tree. Standard one-time wiring.
ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <Provider store={store}>
            <App />
        </Provider>
    </React.StrictMode>
);
