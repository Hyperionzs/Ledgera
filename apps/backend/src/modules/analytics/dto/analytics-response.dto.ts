/**
 * Dashboard Analytics Response DTO
 *
 * High-level operational metrics for the specified date range (default 30 days).
 * All revenue figures use immutable transaction totals (Sale.totalAmount, SaleItem.totalAmount).
 */
export class DashboardMetricsDto {
  // Revenue Metrics (Transaction-Level, Immutable)
  totalRevenue: number = 0;
  totalSalesCount: number = 0;
  averageOrderValue: number = 0;

  // Current State (Point-in-Time)
  totalProducts: number = 0;
  totalCustomers: number = 0;
  lowStockProducts: number = 0;

  // Top Performers (Immutable Historical Data)
  topCustomers: Array<{
    customerId: string;
    customerName: string;
    totalSpent: number;
    transactionCount: number;
  }> = [];

  // Period Metadata
  period: {
    startDate: string;
    endDate: string;
    timezone: string;
  } = { startDate: '', endDate: '', timezone: '' };
}

/**
 * Sales Analytics Response DTO
 *
 * Detailed sales breakdown by date, product, and customer.
 * Pagination: returns subset of sales data sorted by date descending.
 */
export class SalesAnalyticsDto {
  salesByDate: Array<{
    date: string;
    totalRevenue: number;
    transactionCount: number;
    unitsSold: number;
    averageUnitPrice: number;
  }> = [];

  salesByProduct: Array<{
    productId: string;
    productName: string;
    totalRevenue: number;
    unitsSold: number;
    averageUnitPrice: number;
  }> = [];

  summary: {
    period: { startDate: string; endDate: string; timezone: string };
    totalRevenue: number;
    totalUnits: number;
    totalTransactions: number;
    pagination: { limit: number; offset: number; total: number };
  } = {
    period: { startDate: '', endDate: '', timezone: '' },
    totalRevenue: 0,
    totalUnits: 0,
    totalTransactions: 0,
    pagination: { limit: 0, offset: 0, total: 0 },
  };
}

/**
 * Product Analytics Response DTO
 *
 * Detailed product performance metrics with historical sales data.
 */
export class ProductAnalyticsDto {
  products: Array<{
    productId: string;
    productName: string;
    sku: string;
    currentStock: number;
    minimumStock: number;
    isLowStock: boolean;
    totalRevenue: number;
    unitsSold: number;
    averageUnitPrice: number;
    transactions: number;
  }> = [];

  summary: {
    period: { startDate: string; endDate: string; timezone: string };
    totalProductsInPeriod: number;
    totalCurrentProducts: number;
    totalRevenue: number;
    pagination: { limit: number; offset: number; total: number };
  } = {
    period: { startDate: '', endDate: '', timezone: '' },
    totalProductsInPeriod: 0,
    totalCurrentProducts: 0,
    totalRevenue: 0,
    pagination: { limit: 0, offset: 0, total: 0 },
  };
}

/**
 * Customer Analytics Response DTO
 *
 * Customer segmentation and spending analysis.
 */
export class CustomerAnalyticsDto {
  customers: Array<{
    customerId: string;
    customerName: string;
    totalSpent: number;
    transactionCount: number;
    averageOrderValue: number;
    lastPurchaseAt: string | null;
    isReturning: boolean;
    isActive: boolean;
  }> = [];

  summary: {
    period: { startDate: string; endDate: string; timezone: string };
    totalCustomers: number;
    customersInPeriod: number;
    returningCustomers: number;
    totalRevenue: number;
    averageCustomerValue: number;
    pagination: { limit: number; offset: number; total: number };
  } = {
    period: { startDate: '', endDate: '', timezone: '' },
    totalCustomers: 0,
    customersInPeriod: 0,
    returningCustomers: 0,
    totalRevenue: 0,
    averageCustomerValue: 0,
    pagination: { limit: 0, offset: 0, total: 0 },
  };
}

/**
 * Inventory Analytics Response DTO
 *
 * Current inventory levels and stock movement trends.
 */
export class InventoryAnalyticsDto {
  currentInventory: {
    totalSkus: number;
    totalStock: number;
    averageStockPerSku: number;
    lowStockCount: number;
    outOfStockCount: number;
  } = {
    totalSkus: 0,
    totalStock: 0,
    averageStockPerSku: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
  };

  stockMovements: {
    period: { startDate: string; endDate: string; timezone: string };
    stockIn: number;
    stockOut: number;
    adjustments: number;
    netChange: number;
  } = {
    period: { startDate: '', endDate: '', timezone: '' },
    stockIn: 0,
    stockOut: 0,
    adjustments: 0,
    netChange: 0,
  };

  topMovingProducts: Array<{
    productId: string;
    productName: string;
    sku: string;
    currentStock: number;
    unitsMovedOut: number;
    unitsMovedIn: number;
  }> = [];

  summary: {
    pagination: { limit: number; offset: number; total: number };
  } = {
    pagination: { limit: 0, offset: 0, total: 0 },
  };
}

/**
 * Purchase Analytics Response DTO
 *
 * Purchase order summary and supplier analysis.
 */
export class PurchaseAnalyticsDto {
  purchasesBySupplier: Array<{
    supplierName: string;
    supplierId: string | null;
    totalPurchased: number;
    itemsReceived: number;
    purchaseCount: number;
    averagePurchaseValue: number;
  }> = [];

  purchasesByDate: Array<{
    date: string;
    totalAmount: number;
    itemsReceived: number;
    purchaseCount: number;
  }> = [];

  summary: {
    period: { startDate: string; endDate: string; timezone: string };
    totalPurchases: number;
    totalAmount: number;
    totalItems: number;
    averagePurchaseValue: number;
    uniqueSuppliers: number;
    pagination: { limit: number; offset: number; total: number };
  } = {
    period: { startDate: '', endDate: '', timezone: '' },
    totalPurchases: 0,
    totalAmount: 0,
    totalItems: 0,
    averagePurchaseValue: 0,
    uniqueSuppliers: 0,
    pagination: { limit: 0, offset: 0, total: 0 },
  };
}
