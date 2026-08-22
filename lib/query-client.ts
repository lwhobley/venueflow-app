import { QueryClient } from '@tanstack/react-query';

function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : NaN;
  if (Number.isFinite(status) && status >= 400 && status < 500) return false;
  return failureCount < 3;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10000,
      gcTime: 300000,
      retry: shouldRetryQuery,
    },
  },
});
