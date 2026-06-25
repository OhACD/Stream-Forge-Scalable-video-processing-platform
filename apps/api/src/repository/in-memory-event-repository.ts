import { DomainEvent } from "@stream-forge/contracts";
import { EventRepository } from "./event-repository.js";

export class InMemoryEventRepository implements EventRepository {
  private readonly events: DomainEvent[] = [];

  async append(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }

  async listRecent(limit = 500): Promise<DomainEvent[]> {
    return this.events.slice(-limit);
  }

  getAll(): DomainEvent[] {
    return [...this.events];
  }
}
