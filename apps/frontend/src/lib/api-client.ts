import type { ApiError } from '@nexuspos/shared';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

/**
 * Type-safe fetch wrapper for the NexusPOS API.
 * Handles base URL, headers, and error parsing.
 */
export async function apiClient<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error: ApiError = await response.json().catch(() => ({
      success: false as const,
      error: {
        code: 'UNKNOWN_ERROR',
        message: response.statusText,
      },
      timestamp: new Date().toISOString(),
    }));
    throw error;
  }

  return response.json();
}
