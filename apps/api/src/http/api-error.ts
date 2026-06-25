export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    correlationId: string;
    retryable: boolean;
  };
};

export function createApiErrorPayload(
  code: string,
  message: string,
  correlationId: string,
  retryable = false
): ApiErrorPayload {
  return {
    error: {
      code,
      message,
      correlationId,
      retryable
    }
  };
}
