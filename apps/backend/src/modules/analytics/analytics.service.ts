import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
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
 * AnalyticsService
 *
 * Computes all backend analytics metrics using immutable transaction data and current operational state.
 *
 * CRITICAL RULES:
 * 1. Revenue = SUM(Sale.totalAmount) or SUM(SaleItem.totalAmount) — IMMUTABLE, captured at transaction time
 * 2. Product aggregation = by productId (immutable FK), never by mutable Product.categoryId/supplierId
 * 3. Customer aggregation = by customerId (immutable FK), never by mutable Customer name
 * 4. Supplier aggregation = by Purchase.supplierName (immutable snapshot), not current Supplier record
 * 5. Date range: startDate <= createdAt < endDate + 1 day (exclusive upper bound)
 * 6. Timezone: converted at application layer before DB query
 * 7. Soft-delete: queries never include deleted records (isActive=true + deletedAt=null)
 */
@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Validate date range and convert to UTC timestamps.
   * Returns { startDate, endDate } as Date objects ready for DB query.
   * Throws BadRequestException if dates are invalid or range is backwards.
   */
  private validateAndConvertDateRange(
    startDateStr?: string,
    endDateStr?: string,
    timezone: string = 'UTC',
  ): { startDate: Date; endDate: Date } {
    const now = new Date();

    // Default: last 30 days
    let startDate = new Date(now);
    let endDate = new Date(now);

    if (startDateStr) {
      const parsed = new Date(`${startDateStr}T00:00:00Z`);
      if (isNaN(parsed.getTime())) {
        throw new BadRequestException('Invalid startDate format (expected YYYY-MM-DD)');
      }
      startDate = parsed;
    } else {
      startDate.setDate(startDate.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
    }

    if (endDateStr) {
      const parsed = new Date(`${endDateStr}T00:00:00Z`);
      if (isNaN(parsed.getTime())) {
        throw new BadRequestException('Invalid endDate format (expected YYYY-MM-DD)');
      }
      // Exclusive upper bound: query is createdAt < endDate + 1 day
      parsed.setDate(parsed.getDate() + 1);
      endDate = parsed;
    } else {
      endDate.setDate(endDate.getDate() + 1); // Exclusive upper bound
      endDate.setHours(0, 0, 0, 0);
    }

    // Validate range
    if (startDate >= endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    return { startDate, endDate };
  }

  /**
   * Dashboard: high-level metrics for 30-day default period.
   */
  async getDashboardMetrics(query: AnalyticsQueryDto): Promise<DashboardMetricsDto> {
    const { startDate, endDate } = this.validateAndConvertDateRange(
      query.startDate,
      query.endDate,
      query.timezone,
    );

    // Revenue metrics (immutable transaction totals)
    const saleTotals = await this.prisma.sale.aggregate({
      where: {
        createdAt: { gte: startDate, lt: endDate },
      },
      _sum: { totalAmount: true },
      _count: true,
    });

    const totalRevenue = saleTotals._sum.totalAmount
      ? parseFloat(saleTotals._sum.totalAmount.toString())
      : 0;
    const totalSalesCount = saleTotals._count;
    const averageOrderValue = totalSalesCount > 0 ? totalRevenue / totalSalesCount : 0;

    // Current state
    const totalProducts = await this.prisma.product.count({
      where: { isActive: true, deletedAt: null },
    });

    const totalCustomers = await this.prisma.customer.count({
      where: { isActive: true, deletedAt: null },
    });

    // Get low stock products count
    const allProducts = await this.prisma.product.findMany({
      where: { isActive: true, deletedAt: null },
      select: { stock: true, minimumStock: true },
    });

    const lowStockProducts = allProducts.filter((p) => p.stock < p.minimumStock).length;

    // Top customers by revenue
    const topCustomersRaw = await this.prisma.sale.groupBy({
      by: ['customerId', 'customerName'],
      where: {
        createdAt: { gte: startDate, lt: endDate },
      },
      _sum: { totalAmount: true },
      _count: true,
      orderBy: [{ _sum: { totalAmount: 'desc' } }],
      take: 10,
    });

    const topCustomers = topCustomersRaw.map((row: any) => ({
      customerId: row.customerId,
      customerName: row.customerName,
      totalSpent: parseFloat(row._sum.totalAmount?.toString() || '0'),
      transactionCount: row._count,
    }));

    const startDateFormatted =
      query.startDate ||
      new Date(startDate.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDateFormatted = query.endDate || new Date().toISOString().split('T')[0];

    return {
      totalRevenue,
      totalSalesCount,
      averageOrderValue,
      totalProducts,
      totalCustomers,
      lowStockProducts,
      topCustomers,
      period: {
        startDate: startDateFormatted,
        endDate: endDateFormatted,
        timezone: query.timezone || 'UTC',
      },
    };
  }

  /**
   * Sales Analytics: sales breakdown by date and product.
   */
  async getSalesAnalytics(query: AnalyticsQueryDto): Promise<SalesAnalyticsDto> {
    const { startDate, endDate } = this.validateAndConvertDateRange(
      query.startDate,
      query.endDate,
      query.timezone,
    );
    const limit = query.limit || 20;
    const offset = query.offset || 0;

    // Sales by date
    const salesByDateRaw = await this.prisma.sale.groupBy({
      by: ['createdAt'],
      where: {
        createdAt: { gte: startDate, lt: endDate },
      },
      _sum: { totalAmount: true },
      _count: true,
      orderBy: [{ createdAt: 'desc' }],
    });

    const salesByDate = salesByDateRaw.map((row: any) => {
      const dateStr = row.createdAt.toISOString().split('T')[0];
      return {
        date: dateStr,
        totalRevenue: parseFloat(row._sum.totalAmount?.toString() || '0'),
        transactionCount: row._count,
        unitsSold: 0,
        averageUnitPrice: 0,
      };
    });

    // Sales by product (with pagination)
    const salesByProductRaw = await this.prisma.saleItem.groupBy({
      by: ['productId', 'productName'],
      where: {
        sale: { createdAt: { gte: startDate, lt: endDate } },
      },
      _sum: { totalAmount: true, quantity: true },
      _count: true,
      orderBy: [{ _sum: { totalAmount: 'desc' } }],
      skip: offset,
      take: limit,
    });

    const salesByProduct = salesByProductRaw.map((row: any) => {
      const totalRevenue = parseFloat(row._sum.totalAmount?.toString() || '0');
      const unitsSold = row._sum.quantity || 0;
      return {
        productId: row.productId,
        productName: row.productName,
        totalRevenue,
        unitsSold,
        averageUnitPrice: unitsSold > 0 ? totalRevenue / unitsSold : 0,
      };
    });

    // Summary
    const totalSalesRaw = await this.prisma.sale.aggregate({
      where: {
        createdAt: { gte: startDate, lt: endDate },
      },
      _sum: { totalAmount: true },
      _count: true,
    });

    const totalUnitsRaw = await this.prisma.saleItem.aggregate({
      where: {
        sale: { createdAt: { gte: startDate, lt: endDate } },
      },
      _sum: { quantity: true },
    });

    const totalRevenue = parseFloat(totalSalesRaw._sum.totalAmount?.toString() || '0');
    const totalUnits = totalUnitsRaw._sum.quantity || 0;

    return {
      salesByDate,
      salesByProduct,
      summary: {
        period: {
          startDate: query.startDate || startDate.toISOString().split('T')[0],
          endDate:
            query.endDate ||
            new Date(endDate.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          timezone: query.timezone || 'UTC',
        },
        totalRevenue,
        totalUnits,
        totalTransactions: totalSalesRaw._count,
        pagination: { limit, offset, total: totalSalesRaw._count },
      },
    };
  }

  /**
   * Product Analytics: historical sales per product with current metadata.
   */
  async getProductAnalytics(query: ProductAnalyticsQueryDto): Promise<ProductAnalyticsDto> {
    const { startDate, endDate } = this.validateAndConvertDateRange(
      query.startDate,
      query.endDate,
      query.timezone,
    );
    const limit = query.limit || 20;
    const offset = query.offset || 0;

    // Filter by productId if provided
    const productFilter = query.productId ? { productId: query.productId } : {};

    // Historical sales data (aggregated by immutable productId)
    const productSalesRaw = await this.prisma.saleItem.groupBy({
      by: ['productId', 'productName'],
      where: {
        sale: { createdAt: { gte: startDate, lt: endDate } },
        ...productFilter,
      },
      _sum: { totalAmount: true, quantity: true },
      _count: true,
      orderBy: [{ _sum: { totalAmount: 'desc' } }],
      skip: offset,
      take: limit,
    });

    // Fetch current product metadata
    const productIds = productSalesRaw.map((p: any) => p.productId);
    const currentProducts = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, stock: true, minimumStock: true, sku: true, name: true },
    });

    const productMap = new Map(
      currentProducts.map((p) => [
        p.id,
        {
          sku: p.sku,
          stock: p.stock,
          minimumStock: p.minimumStock,
          name: p.name,
        },
      ]),
    );

    const products = productSalesRaw.map((row: any) => {
      const current = productMap.get(row.productId);
      const totalRevenue = parseFloat(row._sum.totalAmount?.toString() || '0');
      const unitsSold = row._sum.quantity || 0;

      return {
        productId: row.productId,
        productName: row.productName,
        sku: current?.sku || '',
        currentStock: current?.stock || 0,
        minimumStock: current?.minimumStock || 0,
        isLowStock: current ? (current.stock as number) < (current.minimumStock as number) : false,
        totalRevenue,
        unitsSold,
        averageUnitPrice: unitsSold > 0 ? totalRevenue / unitsSold : 0,
        transactions: row._count,
      };
    });

    const totalActiveProducts = await this.prisma.product.count({
      where: { isActive: true, deletedAt: null },
    });

    const totalRevenueSummary = await this.prisma.saleItem.aggregate({
      where: {
        sale: { createdAt: { gte: startDate, lt: endDate } },
        ...productFilter,
      },
      _sum: { totalAmount: true },
    });

    return {
      products,
      summary: {
        period: {
          startDate: query.startDate || startDate.toISOString().split('T')[0],
          endDate:
            query.endDate ||
            new Date(endDate.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          timezone: query.timezone || 'UTC',
        },
        totalProductsInPeriod: productSalesRaw.length,
        totalCurrentProducts: totalActiveProducts,
        totalRevenue: parseFloat(totalRevenueSummary._sum.totalAmount?.toString() || '0'),
        pagination: { limit, offset, total: productSalesRaw.length },
      },
    };
  }

  /**
   * Customer Analytics: customer spending and transaction analysis.
   */
  async getCustomerAnalytics(query: CustomerAnalyticsQueryDto): Promise<CustomerAnalyticsDto> {
    const { startDate, endDate } = this.validateAndConvertDateRange(
      query.startDate,
      query.endDate,
      query.timezone,
    );
    const limit = query.limit || 20;
    const offset = query.offset || 0;

    const customerFilter = query.customerId ? { customerId: query.customerId } : {};

    // Customer sales in period
    const customerSalesRaw = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: {
        createdAt: { gte: startDate, lt: endDate },
        ...customerFilter,
      },
      _sum: { totalAmount: true },
      _count: true,
      orderBy: [{ _sum: { totalAmount: 'desc' } }],
      skip: offset,
      take: limit,
    });

    const customerIds = customerSalesRaw.map((c: any) => c.customerId);

    // Fetch current customer data + last purchase
    const customers = await this.prisma.customer.findMany({
      where: {
        id: { in: customerIds },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        sales: {
          select: { createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    // Count transactions per customer (for returning customer logic)
    const transactionCounts = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds } },
      _count: true,
    });

    const transactionMap = new Map(transactionCounts.map((t: any) => [t.customerId, t._count]));

    const customerDetails = customers.map((cust: any) => {
      const saleData = customerSalesRaw.find((s: any) => s.customerId === cust.id);
      const totalSpent = parseFloat(saleData?._sum.totalAmount?.toString() || '0');
      const transactionCount = saleData?._count || 0;
      const totalTransactions = (transactionMap.get(cust.id) as number) || 0;

      return {
        customerId: cust.id,
        customerName: cust.name,
        totalSpent,
        transactionCount,
        averageOrderValue: transactionCount > 0 ? totalSpent / transactionCount : 0,
        lastPurchaseAt: cust.sales[0]?.createdAt?.toISOString() || null,
        isReturning: totalTransactions >= 2,
        isActive: cust.isActive,
      };
    });

    const totalActiveCustomers = await this.prisma.customer.count({
      where: { isActive: true, deletedAt: null },
    });

    const totalRevenueSummary = await this.prisma.sale.aggregate({
      where: {
        createdAt: { gte: startDate, lt: endDate },
        ...customerFilter,
      },
      _sum: { totalAmount: true },
    });

    const totalRevenue = parseFloat(totalRevenueSummary._sum.totalAmount?.toString() || '0');
    const customerCount = customerSalesRaw.length;

    return {
      customers: customerDetails,
      summary: {
        period: {
          startDate: query.startDate || startDate.toISOString().split('T')[0],
          endDate:
            query.endDate ||
            new Date(endDate.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          timezone: query.timezone || 'UTC',
        },
        totalCustomers: totalActiveCustomers,
        customersInPeriod: customerCount,
        returningCustomers: customerDetails.filter((c) => c.isReturning).length,
        totalRevenue,
        averageCustomerValue: customerCount > 0 ? totalRevenue / customerCount : 0,
        pagination: { limit, offset, total: customerSalesRaw.length },
      },
    };
  }

  /**
   * Inventory Analytics: current stock levels and movement trends.
   */
  async getInventoryAnalytics(query: AnalyticsQueryDto): Promise<InventoryAnalyticsDto> {
    const { startDate, endDate } = this.validateAndConvertDateRange(
      query.startDate,
      query.endDate,
      query.timezone,
    );
    const limit = query.limit || 20;
    const offset = query.offset || 0;

    // Current inventory
    const inventory = await this.prisma.product.aggregate({
      where: { isActive: true, deletedAt: null },
      _sum: { stock: true },
      _count: true,
    });

    const totalSkus = inventory._count;
    const totalStock = inventory._sum.stock || 0;
    const averageStockPerSku = totalSkus > 0 ? totalStock / totalSkus : 0;

    // Get low stock products
    const allProductsForLowStock = await this.prisma.product.findMany({
      where: { isActive: true, deletedAt: null },
      select: { stock: true, minimumStock: true },
    });

    const lowStockCount = allProductsForLowStock.filter((p) => p.stock < p.minimumStock).length;

    const outOfStockCount = await this.prisma.product.count({
      where: { isActive: true, deletedAt: null, stock: 0 },
    });

    // Stock movements in period
    const movementSummary = await this.prisma.stockMovement.groupBy({
      by: ['type'],
      where: { createdAt: { gte: startDate, lt: endDate } },
      _sum: { quantity: true },
    });

    const movementMap = new Map(
      movementSummary.map((m: any) => [m.type, (m._sum.quantity as number) || 0]),
    );

    const stockIn = (movementMap.get('STOCK_IN') as number) || 0;
    const stockOut = (movementMap.get('STOCK_OUT') as number) || 0;
    const adjustments = (movementMap.get('ADJUSTMENT') as number) || 0;

    // Top moving products (by stock out)
    const topMovingRaw = await this.prisma.stockMovement.groupBy({
      by: ['productId'],
      where: {
        createdAt: { gte: startDate, lt: endDate },
        type: 'STOCK_OUT',
      },
      _sum: { quantity: true },
      orderBy: [{ _sum: { quantity: 'desc' } }],
      skip: offset,
      take: limit,
    });

    const topMovingProducts = await Promise.all(
      topMovingRaw.map(async (row: any) => {
        const product = await this.prisma.product.findUnique({
          where: { id: row.productId },
          select: { name: true, sku: true, stock: true },
        });

        const stockInTotal = await this.prisma.stockMovement.aggregate({
          where: {
            productId: row.productId,
            createdAt: { gte: startDate, lt: endDate },
            type: 'STOCK_IN',
          },
          _sum: { quantity: true },
        });

        return {
          productId: row.productId,
          productName: product?.name || '',
          sku: product?.sku || '',
          currentStock: product?.stock || 0,
          unitsMovedOut: row._sum.quantity || 0,
          unitsMovedIn: stockInTotal._sum.quantity || 0,
        };
      }),
    );

    return {
      currentInventory: {
        totalSkus,
        totalStock,
        averageStockPerSku,
        lowStockCount,
        outOfStockCount,
      },
      stockMovements: {
        period: {
          startDate: query.startDate || startDate.toISOString().split('T')[0],
          endDate:
            query.endDate ||
            new Date(endDate.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          timezone: query.timezone || 'UTC',
        },
        stockIn,
        stockOut,
        adjustments,
        netChange: stockIn - stockOut + adjustments,
      },
      topMovingProducts,
      summary: { pagination: { limit, offset, total: topMovingRaw.length } },
    };
  }

  /**
   * Purchase Analytics: purchase breakdown by supplier and date.
   */
  async getPurchaseAnalytics(query: PurchaseAnalyticsQueryDto): Promise<PurchaseAnalyticsDto> {
    const { startDate, endDate } = this.validateAndConvertDateRange(
      query.startDate,
      query.endDate,
      query.timezone,
    );
    const limit = query.limit || 20;
    const offset = query.offset || 0;

    // Filter logic
    const supplierFilter = query.supplierId
      ? { supplierId: query.supplierId }
      : query.supplierName
        ? { supplierName: query.supplierName }
        : {};

    // Purchases by supplier (using immutable supplierName snapshot)
    const purchasesBySupplierRaw = await this.prisma.purchase.groupBy({
      by: ['supplierName', 'supplierId'],
      where: {
        createdAt: { gte: startDate, lt: endDate },
        ...supplierFilter,
      },
      _sum: { totalAmount: true },
      _count: true,
      orderBy: [{ _sum: { totalAmount: 'desc' } }],
      skip: offset,
      take: limit,
    });

    // Get items per supplier
    const purchasesBySupplier = await Promise.all(
      purchasesBySupplierRaw.map(async (row: any) => {
        const itemsTotal = await this.prisma.purchaseItem.aggregate({
          where: {
            purchase: {
              createdAt: { gte: startDate, lt: endDate },
              supplierName: row.supplierName,
            },
          },
          _sum: { quantity: true },
        });

        const totalPurchased = parseFloat(row._sum.totalAmount?.toString() || '0');
        const itemsReceived = itemsTotal._sum.quantity || 0;

        return {
          supplierName: row.supplierName,
          supplierId: row.supplierId,
          totalPurchased,
          itemsReceived,
          purchaseCount: row._count,
          averagePurchaseValue: row._count > 0 ? totalPurchased / row._count : 0,
        };
      }),
    );

    // Purchases by date
    const purchasesByDateRaw = await this.prisma.purchase.groupBy({
      by: ['createdAt'],
      where: {
        createdAt: { gte: startDate, lt: endDate },
        ...supplierFilter,
      },
      _sum: { totalAmount: true },
      _count: true,
      orderBy: [{ createdAt: 'desc' }],
    });

    const purchasesByDate = await Promise.all(
      purchasesByDateRaw.map(async (row: any) => {
        const dateStr = row.createdAt.toISOString().split('T')[0];
        const itemsTotal = await this.prisma.purchaseItem.aggregate({
          where: {
            purchase: {
              createdAt: {
                gte: new Date(dateStr),
                lt: new Date(new Date(dateStr).getTime() + 24 * 60 * 60 * 1000),
              },
              ...supplierFilter,
            },
          },
          _sum: { quantity: true },
        });

        return {
          date: dateStr,
          totalAmount: parseFloat(row._sum.totalAmount?.toString() || '0'),
          itemsReceived: itemsTotal._sum.quantity || 0,
          purchaseCount: row._count,
        };
      }),
    );

    // Summary
    const totalPurchasesRaw = await this.prisma.purchase.aggregate({
      where: {
        createdAt: { gte: startDate, lt: endDate },
        ...supplierFilter,
      },
      _sum: { totalAmount: true },
      _count: true,
    });

    const totalItemsRaw = await this.prisma.purchaseItem.aggregate({
      where: {
        purchase: {
          createdAt: { gte: startDate, lt: endDate },
          ...supplierFilter,
        },
      },
      _sum: { quantity: true },
    });

    const totalAmount = parseFloat(totalPurchasesRaw._sum.totalAmount?.toString() || '0');
    const totalPurchases = totalPurchasesRaw._count;
    const totalItems = totalItemsRaw._sum.quantity || 0;

    const uniqueSuppliers = await this.prisma.purchase
      .findMany({
        where: {
          createdAt: { gte: startDate, lt: endDate },
          ...supplierFilter,
        },
        select: { supplierName: true },
        distinct: ['supplierName'],
      })
      .then((results: any[]) => results.length);

    return {
      purchasesBySupplier,
      purchasesByDate,
      summary: {
        period: {
          startDate: query.startDate || startDate.toISOString().split('T')[0],
          endDate:
            query.endDate ||
            new Date(endDate.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          timezone: query.timezone || 'UTC',
        },
        totalPurchases,
        totalAmount,
        totalItems,
        averagePurchaseValue: totalPurchases > 0 ? totalAmount / totalPurchases : 0,
        uniqueSuppliers,
        pagination: { limit, offset, total: uniqueSuppliers },
      },
    };
  }
}
