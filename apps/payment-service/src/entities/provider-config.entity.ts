import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentProvider } from '@app/common';

@Entity('provider_config')
export class ProviderConfig {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 10, unique: true })
  provider: PaymentProvider;

  @Column({ name: 'merchant_id', type: 'varchar', length: 255, nullable: true })
  merchantId: string | null;

  @Column({
    name: 'secret_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  secretEncrypted: string | null;

  @Column({ name: 'base_url', type: 'varchar', length: 1000, nullable: true })
  baseUrl: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
