import {
  Controller,
  DynamicModule,
  Inject,
  Module,
  Optional,
} from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { DataSource } from 'typeorm';

const SERVICE_NAME = Symbol('SERVICE_HEALTH_NAME');

@Controller()
class ServiceHealthController {
  constructor(
    @Inject(SERVICE_NAME) private readonly serviceName: string,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  @MessagePattern({ cmd: 'system.health' })
  async health() {
    if (this.dataSource) await this.dataSource.query('SELECT 1');
    return {
      status: 'ok',
      service: this.serviceName,
      ready: true,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({})
export class ServiceHealthModule {
  static register(serviceName: string): DynamicModule {
    return {
      module: ServiceHealthModule,
      controllers: [ServiceHealthController],
      providers: [{ provide: SERVICE_NAME, useValue: serviceName }],
    };
  }
}
