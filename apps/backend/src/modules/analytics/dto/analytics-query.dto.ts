import { IsOptional, IsString, IsInt, Min, Max, Matches } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Common query parameters for analytics endpoints.
 *
 * Date Range:
 * - startDate, endDate are YYYY-MM-DD calendar dates (inclusive)
 * - DB query uses exclusive upper bound: createdAt < endDate + 1 day
 * - timezone is IANA timezone (e.g., 'Asia/Jakarta', 'UTC')
 * - If no dates provided, endpoint-specific default (usually 30-day period)
 *
 * Pagination:
 * - limit: items per page (default varies by endpoint, max 1000)
 * - offset: 0-based offset (default 0)
 */
export class AnalyticsQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must be YYYY-MM-DD format',
  })
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate must be YYYY-MM-DD format',
  })
  endDate?: string;

  @IsOptional()
  @IsString()
  timezone?: string = 'UTC';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

/**
 * Query DTO for product-specific analytics.
 */
export class ProductAnalyticsQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @IsString()
  productId?: string;
}

/**
 * Query DTO for customer-specific analytics.
 */
export class CustomerAnalyticsQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @IsString()
  customerId?: string;
}

/**
 * Query DTO for supplier/purchase filtering.
 */
export class PurchaseAnalyticsQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  supplierName?: string;
}
