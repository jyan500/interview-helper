import { configureStore } from "@reduxjs/toolkit";
import { interviewApi } from "./api";

// The store wires in the API slice's REDUCER (which holds RTK Query's cache) and its
// MIDDLEWARE (which powers fetching, caching, invalidation, and the loading/error flags
// your hooks expose). This is one-time boilerplate — you rarely touch it again.
export const store = configureStore({
    reducer: {
        [interviewApi.reducerPath]: interviewApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().concat(interviewApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
