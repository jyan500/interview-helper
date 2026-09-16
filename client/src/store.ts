import { configureStore } from "@reduxjs/toolkit";
import { type TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
import { interviewApi } from "./api";
import userReducer from "./userSlice";

// The store wires in the API slice's REDUCER (which holds RTK Query's cache) and its
// MIDDLEWARE (which powers fetching, caching, invalidation, and the loading/error flags
// your hooks expose). This is one-time boilerplate — you rarely touch it again.
//
// `user` is a plain slice (userSlice) holding the current user's display identity (initials +
// avatar URL) so <UserAvatar> reads it with a selector rather than by prop-drilling.
export const store = configureStore({
    reducer: {
        [interviewApi.reducerPath]: interviewApi.reducer,
        user: userReducer,
    },
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().concat(interviewApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Typed versions of the react-redux hooks — use these everywhere instead of the bare hooks so
// selectors/dispatch are type-checked against our RootState/AppDispatch.
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
