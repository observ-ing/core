// Wraps the app in TanStack Query. Mount this INSIDE the Redux <Provider> so
// query hooks can still read UI state (filters, viewer DID) from Redux.
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
// Side-effect import: registers write-mutation defaults (e.g. likes) on the
// shared client before any mutation runs.
import "./mutations";

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
