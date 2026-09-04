import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { RmqClient, sendRpc } from '@app/common';

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(RmqClient.ECHO) private readonly echo: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.PAYMENT) private readonly payment: ClientProxy,
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
    @Inject(RmqClient.FILE) private readonly file: ClientProxy,
    @Inject(RmqClient.NOTIFICATION) private readonly notification: ClientProxy,
    @Inject(RmqClient.SEARCH) private readonly search: ClientProxy,
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
  ) {}

  async check() {
    const clients: Array<[string, ClientProxy]> = [
      ['echo-service', this.echo],
      ['identity-service', this.identity],
      ['catalog-service', this.catalog],
      ['inventory-service', this.inventory],
      ['checkout-service', this.checkout],
      ['payment-service', this.payment],
      ['finance-service', this.finance],
      ['file-service', this.file],
      ['notification-service', this.notification],
      ['search-service', this.search],
      ['elchi-integration', this.integration],
    ];
    const checks = await Promise.allSettled(
      clients.map(([, client]) =>
        sendRpc(client, { cmd: 'system.health' }, {}),
      ),
    );
    const services = Object.fromEntries(
      checks.map((result, index) => [
        clients[index][0],
        result.status === 'fulfilled' ? result.value : { status: 'down' },
      ]),
    );
    const failed = checks
      .map((result, index) =>
        result.status === 'rejected' ? clients[index][0] : null,
      )
      .filter(Boolean);
    if (failed.length) {
      throw new ServiceUnavailableException({
        message: 'Tizim to‘liq tayyor emas',
        failed,
        services,
      });
    }
    return { status: 'ready', services };
  }
}
