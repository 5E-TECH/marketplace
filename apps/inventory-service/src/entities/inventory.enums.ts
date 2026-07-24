export enum StockMovementType {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
  RESERVE = 'RESERVE',
  RELEASE = 'RELEASE',
  COMMIT = 'COMMIT',
  ADJUST = 'ADJUST',
  TRANSFER = 'TRANSFER',
}

export enum ReservationStatus {
  HELD = 'HELD',
  COMMITTED = 'COMMITTED',
  RELEASED = 'RELEASED',
  EXPIRED = 'EXPIRED',
}
