import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { Roles } from '@/common/decorators/roles.decorator';
import { AnalyticsService } from './analytics.service';
import {
  DashboardMetricsDto,
  SalesAnalyticsDto,
  ProductAnalyticsDto,
  CustomerAnalyticsDto,
  InventoryAnalyticsDto,
  PurchaseAnalyticsDto,
} from './dto/analytics-response.dto';
import {
  AnalyticsQueryDto,
  ProductAnalyticsQueryDto,
  CustomerAnalyticsQueryDto,
  PurchaseAnalyticsQueryDto,
} from './dto/analytics-query.dto';

/**
 * AnalyticsController
 *
 * 6 backend analytics endpoints for operational metrics.
 *
 * RBAC per SPRINT_10_DESIGN.md v3 Part 4:
 * - dashboard, sales, products, customers, purchases: OWNER/ADMIN only
 * - inventory: OWNER/ADMIN/CASHIER
 *
 * Response Envelope: Global TransformInterceptor wraps all responses as ApiResponse<T>.
 * Authentication: Global JwtAuthGuard + RolesGuard enforce auth/RBAC.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  /**
   * GET /api/v1/analytics/dashboard
   *
   * High-level operational summary (30-day default).
   * RBAC: OWNER/ADMIN only
   */
  @Get('dashboard')
  @Roles('OWNER' as any, 'ADMIN' as any)
  async getDashboard(@Query() query: AnalyticsQueryDto): Promise<DashboardMetricsDto> {
    try {
      return await this.analyticsService.getDashboardMetrics(query);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Dashboard calculation failed';
      throw new BadRequestException(`Dashboard calculation failed: ${message}`);
    }
  }

  /**
   * GET /api/v1/analytics/sales
   *
   * Sales breakdown by date and product.
   * RBAC: OWNER/ADMIN only
   */
  @Get('sales')
  @Roles('OWNER' as any, 'ADMIN' as any)
  async getSalesAnalytics(@Query() query: AnalyticsQueryDto): Promise<SalesAnalyticsDto> {
    try {
      return await this.analyticsService.getSalesAnalytics(query);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Sales analytics calculation failed';
      throw new BadRequestException(`Sales analytics calculation failed: ${message}`);
    }
  }

  /**
   * GET /api/v1/analytics/products
   *
   * Product performance metrics with historical sales data.
   * RBAC: OWNER/ADMIN only
   */
  @Get('products')
  @Roles('OWNER' as any, 'ADMIN' as any)
  async getProductAnalytics(
    @Query() query: ProductAnalyticsQueryDto,
  ): Promise<ProductAnalyticsDto> {
    try {
      return await this.analyticsService.getProductAnalytics(query);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Product analytics calculation failed';
      throw new BadRequestException(`Product analytics calculation failed: ${message}`);
    }
  }

  /**
   * GET /api/v1/analytics/customers
   *
   * Customer spending and transaction analysis.
   * RBAC: OWNER/ADMIN only
   */
  @Get('customers')
  @Roles('OWNER' as any, 'ADMIN' as any)
  async getCustomerAnalytics(
    @Query() query: CustomerAnalyticsQueryDto,
  ): Promise<CustomerAnalyticsDto> {
    try {
      return await this.analyticsService.getCustomerAnalytics(query);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Customer analytics calculation failed';
      throw new BadRequestException(`Customer analytics calculation failed: ${message}`);
    }
  }

  /**
   * GET /api/v1/analytics/inventory
   *
   * Current inventory levels and stock movement trends.
   * RBAC: OWNER/ADMIN/CASHIER (operational inventory data)
   */
  @Get('inventory')
  @Roles('OWNER' as any, 'ADMIN' as any, 'CASHIER' as any)
  async getInventoryAnalytics(@Query() query: AnalyticsQueryDto): Promise<InventoryAnalyticsDto> {
    try {
      return await this.analyticsService.getInventoryAnalytics(query);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Inventory analytics calculation failed';
      throw new BadRequestException(`Inventory analytics calculation failed: ${message}`);
    }
  }

  /**
   * GET /api/v1/analytics/purchases
   *
   * Purchase order summary and supplier analysis.
   * RBAC: OWNER/ADMIN only
   */
  @Get('purchases')
  @Roles('OWNER' as any, 'ADMIN' as any)
  async getPurchaseAnalytics(
    @Query() query: PurchaseAnalyticsQueryDto,
  ): Promise<PurchaseAnalyticsDto> {
    try {
      return await this.analyticsService.getPurchaseAnalytics(query);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Purchase analytics calculation failed';
      throw new BadRequestException(`Purchase analytics calculation failed: ${message}`);
    }
  }
}
