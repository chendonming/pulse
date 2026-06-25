export interface HeaderInput {
  key: string;
  value: string;
  enabled: boolean;
}

export interface TimingInfo {
  dns_lookup_ms: number;
  tcp_connect_ms: number;
  tls_handshake_ms: number;
  ttfb_ms: number;
  download_ms: number;
  total_ms: number;
}

export interface ResponseData {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  body: string;
  content_type: string | null;
  size: number;
  size_label: string;
  timing: TimingInfo;
}

export interface Collection {
  id: string;
  name: string;
  requests: RequestItem[];
  authType: AuthType;
  bearerToken: string;
}

export interface RequestItem {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: HeaderInput[];
  body: string;
  contentType: string;
  authType: AuthType;
  bearerToken: string;
  params: HeaderInput[];
}

export interface HistoryItem {
  id: string;
  method: string;
  url: string;
  status: number | null;
  timestamp: number;
}

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type AuthType = "none" | "bearer" | "inherit";

export interface AuthConfig {
  type: AuthType;
  bearerToken: string;
}

export interface LogEntry {
  id: number;
  timestamp: number;
  method: string;
  url: string;
  status: number;
  status_text: string;
  size_label: string;
  total_ms: number;
  content_type: string | null;
  error: string | null;
  request_headers: HeaderInput[];
  request_body: string | null;
  response_headers: Record<string, string>;
}

export type RequestTab = "params" | "auth" | "headers" | "body";
export type SidebarTab = "collections" | "history" | "environments";

export interface EnvironmentVariable {
  key: string;
  value: string;
  enabled: boolean;
}

export interface Environment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
}

export interface EnvironmentData {
  environments: Environment[];
  active_id: string | null;
}

export interface CollectionData {
  collections: Collection[];
}
