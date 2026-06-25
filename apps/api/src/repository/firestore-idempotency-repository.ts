import { Firestore } from "@google-cloud/firestore";
import { IdempotencyRecord, IdempotencyRepository } from "./idempotency-repository.js";

const idempotencyCollection = "idempotency_keys";

export class FirestoreIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly firestore: Firestore) {}

  async get(scope: string, key: string): Promise<IdempotencyRecord | null> {
    const snap = await this.firestore.collection(idempotencyCollection).doc(`${scope}:${key}`).get();
    if (!snap.exists) {
      return null;
    }

    return snap.data() as IdempotencyRecord;
  }

  async put(record: IdempotencyRecord): Promise<void> {
    await this.firestore.collection(idempotencyCollection).doc(`${record.scope}:${record.key}`).set(record);
  }
}
