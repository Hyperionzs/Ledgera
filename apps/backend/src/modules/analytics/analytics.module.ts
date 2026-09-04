import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * AnalyticsModule
 *
 * Provides backend analytics API for operational business metrics.
 * 6 endpoints: dashboard, sales, products, customers, inventory, purchases.
 *
 * Dependencies:
 * - PrismaService (injected globally in AppModule)
 * - AuthGuard (JWT authentication, registered in AuthModule)
 *
 * Exports: None (endpoints consumed via HTTP only)
 */
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
