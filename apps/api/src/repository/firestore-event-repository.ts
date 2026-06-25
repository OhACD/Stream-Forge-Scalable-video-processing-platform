import { Firestore } from "@google-cloud/firestore";
import { DomainEvent } from "@stream-forge/contracts";
import { EventRepository } from "./event-repository.js";

const eventsCollection = "events";

export class FirestoreEventRepository implements EventRepository {
  constructor(private readonly firestore: Firestore) {}

  async append(event: DomainEvent): Promise<void> {
    const ref = this.firestore.collection(eventsCollection).doc(event.eventId);
    await ref.set(event);
  }

  async listRecent(limit = 500): Promise<DomainEvent[]> {
    const snapshot = await this.firestore
      .collection(eventsCollection)
      .orderBy("occurredAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((document) => document.data() as DomainEvent).reverse();
  }
}
