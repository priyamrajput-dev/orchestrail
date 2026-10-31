export const API_SCOPES = {
  EVENTS_WRITE: "events:write",
  EVENTS_READ: "events:read",
  ENDPOINTS_READ: "endpoints:read",
  ENDPOINTS_WRITE: "endpoints:write",
  DELIVERIES_READ: "deliveries:read",
  DELIVERIES_REPLAY: "deliveries:replay",
  API_KEYS_READ: "api_keys:read",
  API_KEYS_WRITE: "api_keys:write",
} as const;

export type ApiScope = (typeof API_SCOPES)[keyof typeof API_SCOPES];

export const ALL_SCOPES: ApiScope[] = Object.values(API_SCOPES);

export function isValidScope(scope: string): scope is ApiScope {
  return ALL_SCOPES.includes(scope as ApiScope);
}
