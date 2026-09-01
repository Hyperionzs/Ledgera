import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppModule } from '../../app.module';
import { HashService } from '../auth/hash.service';

/**
 * End-to-end tests for the Sales Management module.
 * Uses the dedicated test database (ledgera_test):
 *   DATABASE_URL=postgresql://nexuspos:nexuspos_dev@localhost:5432/ledgera_test?schema=public pnpm --filter @ledgera/backend test
 */
describe('SalesModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hash: HashService;
  let ownerToken: string;
  let cashierToken: string;
  let seq = 0;

  const email = (prefix: string) =>
    `sal-${prefix.toLowerCase()}-${Date.now()}-${seq++}@ledgera.dev`;
  const sku = () => `SAL-${Date.now()}-${seq++}`;

  const login = async (em: string, password: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: em, password })
      .expect(200);
    return res.body.data.accessToken as string;
  };

  const createUser = async (n: string, role: string) => {
    const em = email(n);
    const passwordHash = await hash.hashPassword('password123');
    return prisma.user.create({
      data: { email: em, name: n, passwordHash, role: role as never, isActive: true },
    });
  };

  const createProduct = (n: string, sellingPrice = 1500) =>
    prisma.product.create({
      data: {
        sku: sku(),
        name: n,
        purchasePrice: 1000,
        sellingPrice,
        stock: 100,
        isActive: true,
      },
    });

  const createSale = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(body);

  const createSaleAs = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/v1/sales')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    hash = app.get(HashService);
  });

  beforeEach(async () => {
    await prisma.saleItem.deleteMany();
    await prisma.sale.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();

    const owner = await createUser('Owner', 'OWNER');
    const cashier = await createUser('Cashier', 'CASHIER');
    ownerToken = await login(owner.email, 'password123');
    cashierToken = await login(cashier.email, 'password123');
  });

  afterAll(async () => {
    await prisma.saleItem.deleteMany();
    await prisma.sale.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /sales', () => {
    it('creates a sale and stocks out the items', async () => {
      const p1 = await createProduct('Item A', 1000);
      const p2 = await createProduct('Item B', 2000);

      const res = await createSale({
        items: [
          { productId: p1.id, quantity: 5 },
          { productId: p2.id, quantity: 3 },
        ],
      }).expect(201);

      expect(res.body.data.status).toBe('COMPLETED');
      expect(Number(res.body.data.totalAmount)).toBe(5 * 1000 + 3 * 2000); // 11000
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.customerName).toBe('Walk-in');

      // Verify stock decremented
      const p1After = await prisma.product.findUnique({ where: { id: p1.id } });
      const p2After = await prisma.product.findUnique({ where: { id: p2.id } });
      expect(p1After?.stock).toBe(95); // 100 - 5
      expect(p2After?.stock).toBe(97); // 100 - 3

      // Verify StockMovement created
      const movements = await prisma.stockMovement.findMany({
        where: { referenceType: 'SALE' },
      });
      expect(movements).toHaveLength(2);
      movements.forEach((m) => {
        expect(m.type).toBe('STOCK_OUT');
        expect(m.referenceId).toBe(res.body.data.id);
      });
    });

    it('snapshots product name at sale time', async () => {
      const p = await createProduct('Original Name', 1500);

      const res = await createSale({
        items: [{ productId: p.id, quantity: 1 }],
      }).expect(201);

      expect(res.body.data.items[0].productName).toBe('Original Name');

      // Change product name
      await prisma.product.update({ where: { id: p.id }, data: { name: 'Changed Name' } });

      // Verify sale snapshot unchanged
      const detail = await request(app.getHttpServer())
        .get(`/api/v1/sales/${res.body.data.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(detail.body.data.items[0].productName).toBe('Original Name');
    });

    it('uses sellingPrice from Product, not client input', async () => {
      const p = await createProduct('Product', 2000); // sellingPrice = 2000

      const res = await createSale({
        items: [{ productId: p.id, quantity: 2 }],
      }).expect(201);

      // Even if client tried to send unitPrice, server uses Product.sellingPrice
      expect(Number(res.body.data.items[0].unitPrice)).toBe(2000);
      expect(Number(res.body.data.totalAmount)).toBe(4000); // 2 * 2000
    });

    it('returns INSUFFICIENT_STOCK error and rolls back entire sale', async () => {
      const p1 = await createProduct('Item A', 1000);
      const p2 = await createProduct('Item B', 2000);

      // Set p2 stock to 2 (not enough for 3)
      await prisma.product.update({ where: { id: p2.id }, data: { stock: 2 } });

      const res = await createSale({
        items: [
          { productId: p1.id, quantity: 5 },
          { productId: p2.id, quantity: 3 }, // will fail
        ],
      }).expect(400);

      // Error can be INSUFFICIENT_STOCK or wrapped as VALIDATION_FAILED — check message
      expect(res.body.error?.message || res.body.error).toContain('INSUFFICIENT_STOCK');

      // Verify entire transaction rolled back
      const sales = await prisma.sale.findMany();
      expect(sales).toHaveLength(0);

      // Verify stock was NOT decremented for p1
      const p1After = await prisma.product.findUnique({ where: { id: p1.id } });
      expect(p1After?.stock).toBe(100);

      // Verify no StockMovement created
      const movements = await prisma.stockMovement.findMany();
      expect(movements).toHaveLength(0);
    });

    it('rejects sale with empty items', async () => {
      const res = await createSale({
        items: [],
      }).expect(400);

      // Validation error — check message contains "items" or "Items"
      expect((res.body.error?.message || res.body.error).toLowerCase()).toContain('items');
    });

    it('rejects sale with duplicate productId', async () => {
      const p = await createProduct('Item', 1000);

      const res = await createSale({
        items: [
          { productId: p.id, quantity: 1 },
          { productId: p.id, quantity: 2 },
        ],
      }).expect(400);

      expect(res.body.error?.message || res.body.error).toContain('Duplicate');
    });

    it('rejects sale if product is soft-deleted', async () => {
      const p = await createProduct('Item', 1000);
      await prisma.product.update({ where: { id: p.id }, data: { deletedAt: new Date() } });

      const res = await createSale({
        items: [{ productId: p.id, quantity: 1 }],
      }).expect(404);

      expect(res.body.error?.message || res.body.error).toBe('PRODUCT_NOT_FOUND');
    });

    it('rejects sale if product is inactive', async () => {
      const p = await createProduct('Item', 1000);
      await prisma.product.update({ where: { id: p.id }, data: { isActive: false } });

      const res = await createSale({
        items: [{ productId: p.id, quantity: 1 }],
      }).expect(404);

      expect(res.body.error?.message || res.body.error).toBe('PRODUCT_NOT_FOUND');
    });

    it('rejects sale if product does not exist', async () => {
      const res = await createSale({
        items: [{ productId: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
      }).expect(404);

      expect(res.body.error?.message || res.body.error).toBe('PRODUCT_NOT_FOUND');
    });

    it('allows CASHIER to create sale', async () => {
      const p = await createProduct('Item', 1000);

      const res = await createSaleAs(cashierToken, {
        items: [{ productId: p.id, quantity: 1 }],
      }).expect(201);

      expect(res.body.data.id).toBeDefined();
    });

    it('allows ADMIN to create sale', async () => {
      const admin = await createUser('Admin', 'ADMIN');
      const adminToken = await login(admin.email, 'password123');
      const p = await createProduct('Item', 1000);

      const res = await createSaleAs(adminToken, {
        items: [{ productId: p.id, quantity: 1 }],
      }).expect(201);

      expect(res.body.data.id).toBeDefined();
    });

    it('rejects unauthenticated request', async () => {
      const p = await createProduct('Item', 1000);

      await request(app.getHttpServer())
        .post('/api/v1/sales')
        .send({ items: [{ productId: p.id, quantity: 1 }] })
        .expect(401);
    });

    it('rejects invalid quantity (0)', async () => {
      const p = await createProduct('Item', 1000);

      await createSale({
        items: [{ productId: p.id, quantity: 0 }],
      }).expect(400);
    });

    it('rejects invalid quantity (negative)', async () => {
      const p = await createProduct('Item', 1000);

      await createSale({
        items: [{ productId: p.id, quantity: -1 }],
      }).expect(400);
    });

    it('rejects invalid quantity (>1M)', async () => {
      const p = await createProduct('Item', 1000);

      await createSale({
        items: [{ productId: p.id, quantity: 1_000_001 }],
      }).expect(400);
    });

    it('rejects non-UUID productId', async () => {
      await createSale({
        items: [{ productId: 'not-a-uuid', quantity: 1 }],
      }).expect(400);
    });

    it('supports walk-in sale', async () => {
      const p = await createProduct('Item', 1000);

      const res = await createSale({
        customerId: null,
        customerName: null,
        items: [{ productId: p.id, quantity: 1 }],
      }).expect(201);

      expect(res.body.data.customerId).toBeNull();
      expect(res.body.data.customerName).toBe('Walk-in');
    });

    it('supports named customer sale', async () => {
      const p = await createProduct('Item', 1000);

      const res = await createSale({
        customerId: '00000000-0000-0000-0000-000000000001',
        customerName: 'John Doe',
        items: [{ productId: p.id, quantity: 1 }],
      }).expect(201);

      expect(res.body.data.customerName).toBe('John Doe');
    });

    it('calculates totalAmount correctly with Decimal precision', async () => {
      const p = await createProduct('Item', 19.99);

      const res = await createSale({
        items: [{ productId: p.id, quantity: 3 }],
      }).expect(201);

      // 3 * 19.99 = 59.97
      expect(Number(res.body.data.totalAmount)).toBe(59.97);
    });

    it('generates referenceNo with SL- prefix', async () => {
      const p = await createProduct('Item', 1000);

      const res = await createSale({
        items: [{ productId: p.id, quantity: 1 }],
      }).expect(201);

      expect(res.body.data.referenceNo).toMatch(/^SL-\d+$/);
    });
  });

  describe('GET /sales', () => {
    it('lists sales with pagination', async () => {
      const p = await createProduct('Item', 1000);

      for (let i = 0; i < 3; i++) {
        await createSale({ items: [{ productId: p.id, quantity: 1 }] }).expect(201);
      }

      const res = await request(app.getHttpServer())
        .get('/api/v1/sales?page=1&limit=2')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.meta.total).toBe(3);
      expect(res.body.data.meta.page).toBe(1);
      expect(res.body.data.meta.limit).toBe(2);
      expect(res.body.data.meta.totalPages).toBe(2);
    });

    it('searches sales by referenceNo', async () => {
      const p = await createProduct('Item', 1000);

      const sale1 = await createSale({ items: [{ productId: p.id, quantity: 1 }] }).expect(201);
      await createSale({ items: [{ productId: p.id, quantity: 1 }] }).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/sales?search=${sale1.body.data.referenceNo}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].referenceNo).toBe(sale1.body.data.referenceNo);
    });

    it('searches sales by customerName', async () => {
      const p = await createProduct('Item', 1000);

      await createSale({
        customerName: 'Alice',
        items: [{ productId: p.id, quantity: 1 }],
      }).expect(201);
      await createSale({
        customerName: 'Bob',
        items: [{ productId: p.id, quantity: 1 }],
      }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/v1/sales?search=Alice')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].customerName).toBe('Alice');
    });

    it('returns newest sales first', async () => {
      const p = await createProduct('Item', 1000);

      const s1 = await createSale({ items: [{ productId: p.id, quantity: 1 }] }).expect(201);
      // small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      const s2 = await createSale({ items: [{ productId: p.id, quantity: 1 }] }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/v1/sales')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.data.items[0].id).toBe(s2.body.data.id);
      expect(res.body.data.items[1].id).toBe(s1.body.data.id);
    });
  });

  describe('GET /sales/:id', () => {
    it('returns sale detail with items', async () => {
      const p = await createProduct('Item', 1000);

      const sale = await createSale({
        items: [{ productId: p.id, quantity: 5 }],
      }).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.body.data.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(sale.body.data.id);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].quantity).toBe(5);
    });

    it('returns 404 for nonexistent sale', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/sales/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('requires authentication', async () => {
      const p = await createProduct('Item', 1000);
      const sale = await createSale({ items: [{ productId: p.id, quantity: 1 }] }).expect(201);

      await request(app.getHttpServer()).get(`/api/v1/sales/${sale.body.data.id}`).expect(401);
    });
  });
});
