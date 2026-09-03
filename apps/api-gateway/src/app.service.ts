import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { Client } from 'pg';
import { RmqClient } from '@app/common';

const CHECK_TIMEOUT_MS = 3_000;

export interface DependencyCheck {
  status: 'ok' | 'down';
  latencyMs: number;
  error?: string;
}

export interface ReadinessResult {
  status: 'ok' | 'degraded';
  service: string;
  uptime: number;
  timestamp: string;
  checks: Record<string, DependencyCheck>;
}

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(RmqClient.ECHO) private readonly echo: ClientProxy,
  ) {}

  /**
   * Tiriklik tekshiruvi — jarayon ko'tarilgan bo'lsa hamisha 200.
   * Docker healthcheck shuni ishlatadi: bog'liqlik vaqtincha yiqilganda
   * konteynerni qayta ishga tushirish muammoni hal qilmaydi.
   */
  health() {
    return {
      status: 'ok',
      service: 'api-gateway',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Tayyorlik tekshiruvi — Postgres va RabbitMQ haqiqatan javob berayotganini
   * tekshiradi. Monitoring va deploy tekshiruvi shuni so'raydi; birortasi
   * yiqilgan bo'lsa `degraded` qaytadi (controller 503 beradi).
   */
  async readiness(): Promise<ReadinessResult> {
    const [database, rabbitmq] = await Promise.all([
      this.checkDatabase(),
      this.checkRabbitmq(),
    ]);

    const checks = { database, rabbitmq };
    const degraded = Object.values(checks).some(
      (check) => check.status !== 'ok',
    );

    return {
      status: degraded ? 'degraded' : 'ok',
      service: 'api-gateway',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async checkDatabase(): Promise<DependencyCheck> {
    const startedAt = Date.now();
    const client = new Client({
      host: this.config.get<string>('DB_HOST'),
      port: this.config.get<number>('DB_PORT'),
      user: this.config.get<string>('DB_USERNAME'),
      password: this.config.get<string>('DB_PASSWORD'),
      database: this.config.get<string>('DB_NAME'),
      connectionTimeoutMillis: CHECK_TIMEOUT_MS,
      statement_timeout: CHECK_TIMEOUT_MS,
    });

    try {
      await client.connect();
      await client.query('SELECT 1');
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      this.logger.warn(`Postgres tekshiruvi muvaffaqiyatsiz: ${String(error)}`);
      return {
        status: 'down',
        latencyMs: Date.now() - startedAt,
        error: 'Postgres javob bermadi',
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async checkRabbitmq(): Promise<DependencyCheck> {
    const startedAt = Date.now();
    try {
      await firstValueFrom(
        this.echo
          .send({ cmd: 'echo' }, { message: 'health' })
          .pipe(timeout(CHECK_TIMEOUT_MS)),
      );
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      this.logger.warn(`RabbitMQ tekshiruvi muvaffaqiyatsiz: ${String(error)}`);
      return {
        status: 'down',
        latencyMs: Date.now() - startedAt,
        error: 'RabbitMQ orqali echo-service javob bermadi',
      };
    }
  }
}
