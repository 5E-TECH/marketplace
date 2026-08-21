export interface PaymeRequest {
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
}

export interface PaymeRpcPayload {
  authorization?: string;
  body: PaymeRequest;
}

export interface PaymeError {
  code: number;
  message: { ru: string; uz: string; en: string };
  data?: string;
}

export type PaymeResponse =
  | { jsonrpc: '2.0'; id: PaymeRequest['id']; result: unknown }
  | { jsonrpc: '2.0'; id: PaymeRequest['id']; error: PaymeError };
