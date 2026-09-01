import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { store } from "./store";
import App from "./App";
import HistoryPage from "./HistoryPage";
import DashboardPage from "./pages/DashboardPage";
import SessionPage from "./pages/SessionPage";
import InterviewsPage from "./pages/InterviewsPage";
import InterviewDetailPage from "./pages/InterviewDetailPage";
import { AuthProvider } from "./auth/AuthProvider";
import LoginPage from "./auth/LoginPage";
import SignupPage from "./auth/SignupPage";
import ForgotPasswordPage from "./auth/ForgotPasswordPage";
import ResetPasswordPage from "./auth/ResetPasswordPage";
import ProtectedRoute from "./auth/ProtectedRoute";
import "./index.css"; // pulls in Tailwind's generated utilities + the Nocturne theme

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
                        {/* PUBLIC — reachable signed out, which is the entire point of them.
                            The Nocturne redesign adds the forgot/reset password flow (mock 4c);
                            reset-password is where the emailed recovery link lands. */}
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/signup" element={<SignupPage />} />
                        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                        <Route path="/reset-password" element={<ResetPasswordPage />} />

                        {/* PROTECTED — a layout route with no path of its own. Everything
                            nested inside renders only if <ProtectedRoute> returns <Outlet />.
                            The Nocturne design pages live here; the old working interview flow
                            (App.tsx) is preserved at /interview-legacy so nothing functional
                            is lost while the new screens are design-only. */}
                        <Route element={<ProtectedRoute />}>
                            <Route path="/" element={<DashboardPage />} />
                            <Route path="/session" element={<SessionPage />} />
                            <Route path="/interviews" element={<InterviewsPage />} />
                            <Route path="/interviews/:id" element={<InterviewDetailPage />} />
                            {/* Preserved: the pre-redesign working interview + history. */}
                            <Route path="/interview-legacy" element={<App />} />
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
