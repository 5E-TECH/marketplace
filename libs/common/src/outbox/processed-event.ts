import { DataSource, EntityManager } from 'typeorm';

/**
 * Idempotent iste'molchi yordamchisi (BE-03, TZ T9-3).
 *
 * Outbox «kamida bir marta» yuboradi: relay hodisani yuborib, PROCESSED
 * belgisini yozishga ulgurmasa, hodisa qayta keladi. Iste'molchi shu
 * yordamchi orqali ishlasa, bir `eventId` uchun ish bir marta bajariladi.
 *
 * Belgi (`processed_event` qatori) va iste'molchining o'z yozuvlari BITTA
 * tranzaksiyada: ish xato bilan tugasa belgi ham qaytariladi va hodisa
 * keyingi urinishda qayta ishlanadi. Bir vaqtda kelgan ikki nusxadan
 * ikkinchisi birinchisining commit'ini kutadi va dublikat deb qaytadi.
 */
export type ProcessOnceResult<T> =
  { duplicate: true } | { duplicate: false; result: T };

const TABLE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

export async function processOnce<T>(
  dataSource: DataSource,
  input: { table: string; consumer: string; eventId: string },
  handle: (manager: EntityManager) => Promise<T>,
): Promise<ProcessOnceResult<T>> {
  if (!TABLE.test(input.table)) {
    throw new Error(`processed_event jadvali nomi noto'g'ri: ${input.table}`);
  }
  if (!input.consumer || !input.eventId) {
    throw new Error('processOnce: consumer va eventId majburiy');
  }
  return dataSource.transaction(async (manager) => {
    const inserted = (await manager.query(
      `INSERT INTO ${input.table} (consumer, event_id) VALUES ($1, $2)
       ON CONFLICT (consumer, event_id) DO NOTHING
       RETURNING event_id`,
      [input.consumer, String(input.eventId)],
    )) as unknown[];
    if (!inserted.length) return { duplicate: true } as const;
    return { duplicate: false, result: await handle(manager) } as const;
  });
}

/** Servis migratsiyasi uchun `processed_event` jadvali SQL i. */
export function processedEventTableSql(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error(`schema nomi noto'g'ri: ${schema}`);
  }
  return `
    CREATE TABLE "${schema}"."processed_event" (
      "consumer" VARCHAR(100) NOT NULL,
      "event_id" VARCHAR(200) NOT NULL,
      "processed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "pk_${schema}_processed_event" PRIMARY KEY ("consumer", "event_id")
    )`;
}
