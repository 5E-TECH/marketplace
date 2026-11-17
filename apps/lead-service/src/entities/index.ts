import { OutboxEvent } from '@app/common';
import { AffiliateApiKey } from './affiliate-api-key.entity';
import { Click } from './click.entity';
import { CapiDelivery, PostbackDelivery } from './delivery.entity';
import { LeadAttempt } from './lead-attempt.entity';
import { LeadHistory } from './lead-history.entity';
import { Lead } from './lead.entity';
import { OperatorState } from './operator-state.entity';
import { Stream } from './stream.entity';

export {
  AffiliateApiKey,
  CapiDelivery,
  Click,
  Lead,
  LeadAttempt,
  LeadHistory,
  OperatorState,
  PostbackDelivery,
  Stream,
};

/** lead sxemasidagi hamma jadval (outbox — BE-13 lead.confirmed uchun). */
export const LEAD_ENTITIES = [
  Stream,
  Click,
  Lead,
  LeadAttempt,
  LeadHistory,
  OperatorState,
  PostbackDelivery,
  CapiDelivery,
  AffiliateApiKey,
  OutboxEvent,
];
