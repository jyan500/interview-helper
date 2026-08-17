import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { store } from "./store";
import App from "./App";
import HistoryPage from "./HistoryPage";
import { AuthProvider } from "./auth/AuthProvider";
import LoginPage from "./auth/LoginPage";
import ProtectedRoute from "./auth/ProtectedRoute";
import SignupPage from "./auth/SignupPage";
import "./index.css"; // pulls in Tailwind's generated utilities

// <Provider> makes the Redux store — and therefore the RTK Query cache and hooks —
// available to every component in the tree. Standard one-time wiring.
//
// PHASE B ADDS TWO MORE WRAPPERS, and the nesting order is not arbitrary:
//
//   <Provider>          Redux / RTK Query cache — outermost, knows nothing about routing
//     <BrowserRouter>   owns the URL. Must be OUTSIDE anything calling useNavigate/useLocation
//       <AuthProvider>  the session mirror. Inside the router (so it could redirect on
//                       sign-out later), outside <Routes> so EVERY page — login included —
//                       can call useAuth().
//         <Routes>      the page table
//
// WHY THERE'S A ROUTER AT ALL NOW: until Phase B this SPA had exactly one screen, so the URL
// never had to mean anything. Auth introduces a second destination you can be SENT to (the
// login page) and returned FROM — that's navigation. Hand-rolling it with a `page` state
// variable costs you the back button, deep links, and "return me to where I was".
// It's also what makes Phase C's History view one more <Route> instead of another boolean.
//
// ONE DEPLOY CONSEQUENCE, for Phase G: a real router means a browser can request /login
// directly, and a static host will look for a FILE at that path and 404. The fix is the SPA
// rewrite in `client/vercel.json` ("serve index.html for everything") — already noted in the
// build plan; nothing to do while Vite's dev server handles it for you.
ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <Provider store={store}>
            <BrowserRouter>
                <AuthProvider>
                    <Routes>
                        {/* PUBLIC — reachable signed out, which is the entire point of them. */}
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/signup" element={<SignupPage />} />

                        {/* PROTECTED — a layout route with no path of its own. Everything
                            nested inside renders only if <ProtectedRoute> returns <Outlet />.
                            Phase C's /history goes in this block: one line, no new plumbing. */}
                        <Route element={<ProtectedRoute />}>
                            <Route path="/" element={<App />} />
                            {/* Phase C — the History view. One line, no new plumbing: it's
                                gated by the same <ProtectedRoute> and speaks to the same API. */}
                            <Route path="/history" element={<HistoryPage />} />
                        </Route>

                        {/* anything else -> home, which is itself gated. `replace` so a
                            mistyped URL doesn't linger in history. */}
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </AuthProvider>
            </BrowserRouter>
        </Provider>
    </React.StrictMode>
);
