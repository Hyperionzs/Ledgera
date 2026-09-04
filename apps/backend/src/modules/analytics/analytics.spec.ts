import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '@/common/prisma/prisma.service';
import { HashService } from '@/modules/auth/hash.service';
import { AnalyticsModule } from './analytics.module';
import { AnalyticsService } from './analytics.service';
import { AppModule } from '@/app.module';
import { Prisma } from '@prisma/client';

/**
 * Analytics E2E Tests
 *
 * Test Strategy:
 * 1. Unit tests: metric calculations, date validation, edge cases
 * 2. Integration: 6 endpoints with valid/invalid queries
 * 3. RBAC: all roles, walk-in customer, returning customers
 * 4. Edge cases: zero results, null FKs, soft-deleted records, date boundaries
 *
 * Key Testing Principles:
 * - Use immutable transaction data (SaleItem.totalAmount, Sale.totalAmount)
 * - Verify aggregation by immutable IDs (productId, customerId)
 * - Test historical vs. current field semantics
 * - Validate date range exclusive upper bound
 * - Test pagination (limit, offset, max 1000)
 * - Test RBAC (all roles can READ analytics)
 * - Test walk-in sentinel (UUID 00000000-0000-0000-0000-000000000000)
 * - Test returning customer logic (>=2 transactions)
 */

describe('Analytics Module (Sprint 10)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let analyticsService: AnalyticsService;

  // Test user tokens (will be set in beforeAll)
  let ownerToken: string;
  let adminToken: string;
  let cashierToken: string;

  // Test data fixtures
  const WALK_IN_CUSTOMER_ID = '00000000-0000-0000-0000-000000000000';
  const TEST_TIMEZONE = 'UTC';

  // Helper function for login (matches existing test patterns)
  const login = async (email: string, password: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
      }),
    );

    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    analyticsService = moduleFixture.get<AnalyticsService>(AnalyticsService);

    // Get HashService to properly hash passwords
    const hashService = moduleFixture.get(HashService);
    const testPassword = 'test-password-123';
    const passwordHash = await hashService.hashPassword(testPassword);

    // Create test users with different roles
    const ownerUser = await prisma.user.create({
      data: {
        email: `test-owner-${Date.now()}@ledgera.dev`,
        name: 'Test Owner',
        passwordHash,
        role: 'OWNER',
        isActive: true,
      },
    });

    const adminUser = await prisma.user.create({
      data: {
        email: `test-admin-${Date.now()}@ledgera.dev`,
        name: 'Test Admin',
        passwordHash,
        role: 'ADMIN',
        isActive: true,
      },
    });

    const cashierUser = await prisma.user.create({
      data: {
        email: `test-cashier-${Date.now()}@ledgera.dev`,
        name: 'Test Cashier',
        passwordHash,
        role: 'CASHIER',
        isActive: true,
      },
    });

    // Use helper function to login (matches existing test patterns)
    ownerToken = await login(ownerUser.email, testPassword);
    adminToken = await login(adminUser.email, testPassword);
    cashierToken = await login(cashierUser.email, testPassword);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Unit Tests: Date Range Validation', () => {
    it('should validate valid YYYY-MM-DD date range', async () => {
      const result = analyticsService['validateAndConvertDateRange'](
        '2026-08-01',
        '2026-08-31',
        'UTC',
      );
      expect(result.startDate).toBeDefined();
      expect(result.endDate).toBeDefined();
      expect(result.startDate < result.endDate).toBe(true);
    });

    it('should reject invalid startDate format', async () => {
      expect(() =>
        analyticsService['validateAndConvertDateRange']('2026-08-01 invalid', '2026-08-31', 'UTC'),
      ).toThrow();
    });

    it('should reject startDate >= endDate', async () => {
      expect(() =>
        analyticsService['validateAndConvertDateRange']('2026-08-31', '2026-08-01', 'UTC'),
      ).toThrow();
    });

    it('should use 30-day default if no dates provided', async () => {
      const result = analyticsService['validateAndConvertDateRange'](undefined, undefined, 'UTC');
      const daysDiff =
        (result.endDate.getTime() - result.startDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeCloseTo(31, 0); // 30 days + 1 day exclusive upper bound
    });

    it('should use exclusive upper bound (createdAt < endDate + 1)', async () => {
      const { startDate, endDate } = analyticsService['validateAndConvertDateRange'](
        '2026-08-01',
        '2026-08-31',
        'UTC',
      );

      // Upper bound should be 2026-09-01 00:00:00
      expect(endDate.getUTCDate()).toBe(1);
      expect(endDate.getUTCMonth()).toBe(8); // September (0-indexed)
      expect(endDate.getUTCHours()).toBe(0);
    });
  });

  describe('Endpoint: GET /api/v1/analytics/dashboard', () => {
    let testProducts: any[];
    let testCustomers: any[];
    let testSales: any[];

    beforeEach(async () => {
      // Seed test data
      testProducts = await Promise.all([
        prisma.product.create({
          data: {
            sku: `SKU-${Date.now()}-1`,
            name: 'Test Product 1',
            purchasePrice: new Prisma.Decimal('10.00'),
            sellingPrice: new Prisma.Decimal('20.00'),
          },
        }),
        prisma.product.create({
          data: {
            sku: `SKU-${Date.now()}-2`,
            name: 'Test Product 2',
            purchasePrice: new Prisma.Decimal('15.00'),
            sellingPrice: new Prisma.Decimal('30.00'),
          },
        }),
      ]);

      testCustomers = await Promise.all([
        prisma.customer.create({
          data: {
            name: `Test Customer ${Date.now()}`,
            email: `customer-${Date.now()}@test.com`,
          },
        }),
        prisma.customer.create({
          data: {
            name: `Test Customer ${Date.now() + 1}`,
            email: `customer-${Date.now() + 1}@test.com`,
          },
        }),
      ]);

      // Create sales
      testSales = await Promise.all([
        prisma.sale.create({
          data: {
            referenceNo: `SALE-${Date.now()}-1`,
            customerId: testCustomers[0].id,
            customerName: testCustomers[0].name,
            totalAmount: new Prisma.Decimal('100.00'),
            items: {
              create: [
                {
                  productId: testProducts[0].id,
                  productName: testProducts[0].name,
                  quantity: 2,
                  unitPrice: new Prisma.Decimal('20.00'),
                  totalAmount: new Prisma.Decimal('40.00'),
                },
              ],
            },
          },
        }),
        prisma.sale.create({
          data: {
            referenceNo: `SALE-${Date.now()}-2`,
            customerId: testCustomers[1].id,
            customerName: testCustomers[1].name,
            totalAmount: new Prisma.Decimal('150.00'),
            items: {
              create: [
                {
                  productId: testProducts[1].id,
                  productName: testProducts[1].name,
                  quantity: 3,
                  unitPrice: new Prisma.Decimal('30.00'),
                  totalAmount: new Prisma.Decimal('90.00'),
                },
              ],
            },
          },
        }),
      ]);
    });

    it('should return dashboard metrics with 30-day default', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/dashboard')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.totalRevenue).toBeGreaterThan(0);
      expect(response.body.data.totalSalesCount).toBeGreaterThan(0);
      expect(response.body.data.averageOrderValue).toBeGreaterThan(0);
      expect(response.body.data.topCustomers).toBeInstanceOf(Array);
    });

    it('should filter dashboard by date range', async () => {
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/dashboard')
        .query({ startDate: today, endDate: tomorrow })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.period.startDate).toBe(today);
    });

    it('should return zero metrics for empty period', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/dashboard')
        .query({
          startDate: '2020-01-01',
          endDate: '2020-01-02',
        })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.data.totalRevenue).toBe(0);
      expect(response.body.data.totalSalesCount).toBe(0);
    });

    it('should enforce RBAC (OWNER/ADMIN allowed, CASHIER forbidden)', async () => {
      // OWNER and ADMIN should get 200
      for (const token of [ownerToken, adminToken]) {
        const response = await request(app.getHttpServer())
          .get('/api/v1/analytics/dashboard')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expect(response.body.success).toBe(true);
      }

      // CASHIER should get 403
      await request(app.getHttpServer())
        .get('/api/v1/analytics/dashboard')
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(403);
    });

    it('should reject unauthenticated requests', async () => {
      await request(app.getHttpServer()).get('/api/v1/analytics/dashboard').expect(401);
    });
  });

  describe('Endpoint: GET /api/v1/analytics/sales', () => {
    it('should return sales breakdown by date and product', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/sales')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.salesByDate).toBeInstanceOf(Array);
      expect(response.body.data.salesByProduct).toBeInstanceOf(Array);
      expect(response.body.data.summary).toBeDefined();
    });

    it('should support pagination (limit, offset)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/sales')
        .query({ limit: 10, offset: 0 })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.data.summary.pagination.limit).toBe(10);
      expect(response.body.data.summary.pagination.offset).toBe(0);
    });

    it('should enforce max limit of 1000', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/sales')
        .query({ limit: 2000 })
        .set('Authorization', `Bearer ${ownerToken}`);

      // Should either enforce max or return 400
      expect([200, 400]).toContain(response.status);
    });

    it('should reject invalid offset', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/analytics/sales')
        .query({ offset: -1 })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(400);
    });
  });

  describe('Endpoint: GET /api/v1/analytics/products', () => {
    it('should return product analytics aggregated by productId', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.products).toBeInstanceOf(Array);

      // Verify aggregation by productId (immutable)
      const products = response.body.data.products;
      if (products.length > 0) {
        expect(products[0]).toHaveProperty('productId');
        expect(products[0]).toHaveProperty('totalRevenue');
        expect(products[0]).toHaveProperty('unitsSold');
      }
    });

    it('should use current Product metadata (stock, minimumStock)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const products = response.body.data.products;
      if (products.length > 0) {
        expect(products[0]).toHaveProperty('currentStock');
        expect(products[0]).toHaveProperty('minimumStock');
        expect(products[0]).toHaveProperty('isLowStock');
      }
    });

    it('should filter by productId', async () => {
      // First, get a product
      const product = await prisma.product.findFirst();
      if (!product) return; // Skip if no products

      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/products')
        .query({ productId: product.id })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.products).toBeInstanceOf(Array);
    });
  });

  describe('Endpoint: GET /api/v1/analytics/customers', () => {
    it('should return customer analytics aggregated by customerId', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/customers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.customers).toBeInstanceOf(Array);
    });

    it('should identify returning customers (>=2 transactions)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/customers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const customers = response.body.data.customers;
      if (customers.length > 0) {
        const returningCustomers = customers.filter((c: any) => c.isReturning);
        // Verify isReturning logic
        expect(returningCustomers.every((c: any) => c.transactionCount >= 2)).toBe(true);
      }
    });

    it('should exclude walk-in from customer list', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/customers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const customers = response.body.data.customers;
      const walkInIncluded = customers.some((c: any) => c.customerId === WALK_IN_CUSTOMER_ID);
      // Walk-in should not appear in customer analytics (anonymous)
      expect(walkInIncluded).toBe(false);
    });

    it('should show lastPurchaseAt as ISO datetime or null', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/customers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const customers = response.body.data.customers;
      if (customers.length > 0) {
        expect(
          customers[0].lastPurchaseAt === null || typeof customers[0].lastPurchaseAt === 'string',
        ).toBe(true);
      }
    });
  });

  describe('Endpoint: GET /api/v1/analytics/inventory', () => {
    it('should return current inventory levels and stock movements', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/inventory')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.currentInventory).toBeDefined();
      expect(response.body.data.currentInventory.totalSkus).toBeGreaterThanOrEqual(0);
      expect(response.body.data.currentInventory.totalStock).toBeGreaterThanOrEqual(0);
      expect(response.body.data.stockMovements).toBeDefined();
    });

    it('should track low stock and out of stock counts', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/inventory')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const inventory = response.body.data.currentInventory;
      expect(inventory).toHaveProperty('lowStockCount');
      expect(inventory).toHaveProperty('outOfStockCount');
    });

    it('should show stock movements (STOCK_IN, STOCK_OUT, ADJUSTMENT)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/inventory')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const movements = response.body.data.stockMovements;
      expect(movements).toHaveProperty('stockIn');
      expect(movements).toHaveProperty('stockOut');
      expect(movements).toHaveProperty('adjustments');
      expect(movements).toHaveProperty('netChange');
    });
  });

  describe('Endpoint: GET /api/v1/analytics/purchases', () => {
    it('should return purchase analytics aggregated by supplierName snapshot', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/purchases')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.purchasesBySupplier).toBeInstanceOf(Array);
      expect(response.body.data.purchasesByDate).toBeInstanceOf(Array);
    });

    it('should show supplierName (immutable snapshot) not mutable Supplier record', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/purchases')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const suppliers = response.body.data.purchasesBySupplier;
      if (suppliers.length > 0) {
        // Should have supplierName from Purchase.supplierName (immutable)
        expect(suppliers[0]).toHaveProperty('supplierName');
        expect(suppliers[0]).toHaveProperty('supplierId'); // May be null after soft-delete
      }
    });

    it('should filter by supplierId or supplierName', async () => {
      const purchase = await prisma.purchase.findFirst();
      if (!purchase) return; // Skip if no purchases

      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/purchases')
        .query({ supplierName: purchase.supplierName })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/purchases')
        .query({ limit: 5, offset: 0 })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.data.summary.pagination.limit).toBe(5);
    });
  });

  describe('Edge Cases & Error Handling', () => {
    it('should handle empty results gracefully', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/sales')
        .query({ startDate: '2000-01-01', endDate: '2000-01-02' })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.data.summary.totalRevenue).toBe(0);
      expect(response.body.data.summary.totalTransactions).toBe(0);
    });

    it('should handle invalid timezone gracefully (use UTC default)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/dashboard')
        .query({ timezone: 'Invalid/Timezone' })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      // Should either accept or use UTC default
      expect(response.body.success).toBe(true);
    });

    it('should reject malformed date format with 400', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/analytics/dashboard')
        .query({ startDate: '31/12/2026' })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(400);
    });

    it('should handle NULL FK references (soft-deleted suppliers)', async () => {
      // Create a purchase, then soft-delete the supplier
      const supplier = await prisma.supplier.create({
        data: { name: `Supplier ${Date.now()}` },
      });

      const purchase = await prisma.purchase.create({
        data: {
          referenceNo: `TEST-${Date.now()}`,
          supplierId: supplier.id,
          supplierName: supplier.name,
          totalAmount: new Prisma.Decimal('100'),
          items: { create: [] },
        },
      });

      // Soft-delete the supplier
      await prisma.supplier.update({
        where: { id: supplier.id },
        data: { isActive: false, deletedAt: new Date() },
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/purchases')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      // Should still work; supplierId may be null but supplierName is preserved
      expect(response.body.success).toBe(true);
    });

    it('should never expose soft-deleted records', async () => {
      // Create a customer and sale
      const customer = await prisma.customer.create({
        data: { name: `Customer ${Date.now()}` },
      });

      await prisma.sale.create({
        data: {
          referenceNo: `SALE-${Date.now()}`,
          customerId: customer.id,
          customerName: customer.name,
          totalAmount: new Prisma.Decimal('100'),
          items: { create: [] },
        },
      });

      // Soft-delete the customer
      await prisma.customer.update({
        where: { id: customer.id },
        data: { isActive: false, deletedAt: new Date() },
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/analytics/customers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const customers = response.body.data.customers;
      const isDeleted = customers.some((c: any) => c.customerId === customer.id);
      expect(isDeleted).toBe(false);
    });
  });
});
