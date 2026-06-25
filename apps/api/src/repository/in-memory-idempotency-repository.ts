import { IdempotencyRecord, IdempotencyRepository } from "./idempotency-repository.js";

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly records = new Map<string, IdempotencyRecord>();

  async get(scope: string, key: string): Promise<IdempotencyRecord | null> {
    return this.records.get(`${scope}:${key}`) ?? null;
  }

  async put(record: IdempotencyRecord): Promise<void> {
    this.records.set(`${record.scope}:${record.key}`, record);
  }
}
