import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /**
   * Tiriklik tekshiruvi — jarayon ko'tarilgan bo'lsa hamisha 200.
   * Bog'liqliklar `ReadinessService` da tekshiriladi (/health/readiness).
   */
  health() {
    return {
      status: 'ok',
      service: 'api-gateway',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
