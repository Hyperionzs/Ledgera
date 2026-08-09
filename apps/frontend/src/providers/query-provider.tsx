import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import type { ReactNode } from 'react';

interface QueryProviderProps {
  children: ReactNode;
}

/**
 * Wraps the app with TanStack Query's provider.
 * Additional providers (auth, theme, etc.) will be composed here.
 */
export function QueryProvider({ children }: QueryProviderProps) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
