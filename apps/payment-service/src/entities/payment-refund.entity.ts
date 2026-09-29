import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '@app/common';

/**
 * C4.2 — qisman refund yozuvi. Bitta to'lovdan bir necha marta qisman pul
 * qaytarilishi mumkin; jami qaytarilgan summa to'lov summasidan oshmaydi.
 * `idempotency_key` takroriy so'rovni ikkinchi marta yozishdan saqlaydi.
 */
@Entity('payment_refund')
@Index('idx_payment_refund_payment', ['paymentId'])
export class PaymentRefund {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'payment_id', type: 'bigint' })
  paymentId: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ type: 'text' })
  reason: string;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 255,
    unique: true,
  })
  idempotencyKey: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
