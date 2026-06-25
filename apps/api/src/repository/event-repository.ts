import { DomainEvent } from "@stream-forge/contracts";

export interface EventRepository {
  append(event: DomainEvent): Promise<void>;
  listRecent(limit?: number): Promise<DomainEvent[]>;
}
