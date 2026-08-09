// ============================================================================
// App-wide Constants
// Shared between frontend and backend for consistency
// ============================================================================

/** Default pagination settings */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

/** Application metadata */
export const APP = {
  NAME: 'Ledgera',
  VERSION: '0.0.1',
  API_PREFIX: '/api/v1',
  DESCRIPTION: 'Modern web-based Point of Sale system',
} as const;

/** Common status enums */
export enum Status {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ARCHIVED = 'ARCHIVED',
}

/** Sort order options */
export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/** Application roles — single role per user (MVP) */
export enum Role {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  CASHIER = 'CASHIER',
}
