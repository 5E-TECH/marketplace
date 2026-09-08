import { EntityManager, Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';

// Shared by both callback providers. The transaction-scoped lock serializes
// state transitions across replicas, including two different provider IDs.
// Deliberately coarse for MVP; no network I/O belongs inside this transaction.
export function paymentAtomic<T>(
  repo: Repository<Payment>,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return repo.manager.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [6303, 1]);
    return work(manager);
  });
}

export function validReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9]\d{0,18}$/.test(value) &&
    BigInt(value) <= BigInt('9223372036854775807')
  );
}
