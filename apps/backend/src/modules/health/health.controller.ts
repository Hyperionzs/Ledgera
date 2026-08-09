import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { APP } from '@ledgera/shared';
import type { HealthCheckResponse } from '@ledgera/shared';
import { Public } from '@/common/decorators/public.decorator';

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthCheckResponse> {
    const isDbHealthy = await this.prisma.isHealthy();

    return {
      status: isDbHealthy ? 'ok' : 'error',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: isDbHealthy ? 'connected' : 'disconnected',
      version: APP.VERSION,
    };
  }
}
