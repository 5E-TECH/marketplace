import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('inventory_operation')
export class InventoryOperation {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  key: string;

  @Column({ type: 'jsonb' })
  response: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
