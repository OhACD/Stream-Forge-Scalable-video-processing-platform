export type IdempotencyRecord = {
  scope: string;
  key: string;
  statusCode: number;
  responseBody: unknown;
  createdAt: string;
};

export interface IdempotencyRepository {
  get(scope: string, key: string): Promise<IdempotencyRecord | null>;
  put(record: IdempotencyRecord): Promise<void>;
}
