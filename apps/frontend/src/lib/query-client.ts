import { QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query client with sensible defaults for a POS system.
 * - staleTime: 30s — POS data changes frequently
 * - retry: 1 — fail fast for responsive UX
 * - refetchOnWindowFocus: true — always show fresh data when user returns
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
