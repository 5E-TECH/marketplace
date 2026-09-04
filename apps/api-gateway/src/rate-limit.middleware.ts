import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';

type Bucket = { count: number; resetAt: number };

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly config: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction) {
    if (
      req.path.endsWith('/health') ||
      req.path.includes('/health/readiness')
    ) {
      return next();
    }
    const now = Date.now();
    const windowMs = this.config.get<number>('RATE_LIMIT_WINDOW_MS', 60_000);
    const max = this.config.get<number>('RATE_LIMIT_MAX', 100);
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - bucket.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(bucket.resetAt / 1000));
    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({
        statusCode: 429,
        message: 'Juda ko‘p so‘rov yuborildi',
        errorCode: 'RATE_LIMITED',
      });
    }
    return next();
  }
}
