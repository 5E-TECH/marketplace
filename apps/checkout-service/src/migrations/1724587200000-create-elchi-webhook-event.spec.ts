import { CreateElchiWebhookEvent1724587200000 } from './1724587200000-create-elchi-webhook-event';

describe('CreateElchiWebhookEvent migration', () => {
  it('event_id primary key bilan idempotency jadvalini yaratadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CreateElchiWebhookEvent1724587200000().up({ query } as never);
    const sql = query.mock.calls.flat().join('\n');
    expect(sql).toContain('checkout.elchi_webhook_event');
    expect(sql).toContain('event_id VARCHAR(128) PRIMARY KEY');
  });
});
