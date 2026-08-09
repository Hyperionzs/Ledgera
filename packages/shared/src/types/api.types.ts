// ============================================================================
// API Response Types
// Standard response wrappers used by all API endpoints
// ============================================================================

/**
 * Standard successful API response wrapper.
 * Every endpoint returns data in this format for consistency.
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp: string;
}

/**
 * Paginated API response for list endpoints.
 * Includes metadata needed to render pagination controls.
 */
export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: PaginationMeta;
  timestamp: string;
}

/**
 * Pagination metadata.
 */
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * Standard API error response.
 */
export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  timestamp: string;
}

/**
 * Query parameters for paginated list endpoints.
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

/**
 * Health check response from GET /api/v1/health
 */
export interface HealthCheckResponse {
  status: 'ok' | 'error';
  uptime: number;
  timestamp: string;
  database: 'connected' | 'disconnected';
  version: string;
}
