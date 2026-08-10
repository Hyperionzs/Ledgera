import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppModule } from '../../app.module';
import { HashService } from '../auth/hash.service';

/**
 * End-to-end tests for the Inventory Management module.
 * Uses the dedicated test database (ledgera_test):
 *   DATABASE_URL=postgresql://nexuspos:nexuspos_dev@localhost:5432/ledgera_test?schema=public pnpm --filter @ledgera/backend test
 */
describe('InventoryModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hash: HashService;
  let ownerToken: string;
  let cashierToken: string;
  let seq = 0;

  const email = (prefix: string) =>
    `inv-${prefix.toLowerCase()}-${Date.now()}-${seq++}@ledgera.dev`;
  const sku = () => `SKU-${Date.now()}-${seq++}`;

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

  const createProduct = (name: string) =>
    prisma.product.create({
      data: { sku: sku(), name, purchasePrice: 1000, sellingPrice: 1500, stock: 0 },
    });

  const stockIn = (productId: string, quantity: number, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/inventory/stock-in')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ productId, quantity, ...body });

  const stockOut = (productId: string, quantity: number) =>
    request(app.getHttpServer())
      .post('/api/v1/inventory/stock-out')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ productId, quantity });

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
    await prisma.stockMovement.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.supplier.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();

    const owner = await createUser('Owner', 'OWNER');
    const cashier = await createUser('Cashier', 'CASHIER');

    ownerToken = await login(owner.email, 'password123');
    cashierToken = await login(cashier.email, 'password123');
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany();
    await prisma.product.deleteMany();
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /inventory/stock-in', () => {
    it('increases product stock and records a movement', async () => {
      const p = await createProduct('StockIn Product');
      const res = await stockIn(p.id, 10).expect(201);
      expect(res.body.data.type).toBe('STOCK_IN');
      expect(res.body.data.beforeStock).toBe(0);
      expect(res.body.data.afterStock).toBe(10);

      const movements = await prisma.stockMovement.count({ where: { productId: p.id } });
      expect(movements).toBe(1);
      const refreshed = await prisma.product.findUnique({ where: { id: p.id } });
      expect(refreshed?.stock).toBe(10);
    });

    it('two sequential stock-in accumulate correctly', async () => {
      const p = await createProduct('Accumulate');
      await stockIn(p.id, 5).expect(201);
      const res = await stockIn(p.id, 7).expect(201);
      expect(res.body.data.beforeStock).toBe(5);
      expect(res.body.data.afterStock).toBe(12);
      const refreshed = await prisma.product.findUnique({ where: { id: p.id } });
      expect(refreshed?.stock).toBe(12);
    });

    it('stores before/after snapshots correctly', async () => {
      const p = await createProduct('Snapshot');
      await stockIn(p.id, 3).expect(201);
      await stockIn(p.id, 4).expect(201);
      const movements = await prisma.stockMovement.findMany({
        where: { productId: p.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(movements[0]).toMatchObject({ beforeStock: 0, afterStock: 3 });
      expect(movements[1]).toMatchObject({ beforeStock: 3, afterStock: 7 });
    });

    it('quantity 0 or negative returns 400', async () => {
      const p = await createProduct('Bad Qty');
      await stockIn(p.id, 0).expect(400);
      await stockIn(p.id, -5).expect(400);
    });

    it('stores referenceType and referenceId when provided', async () => {
      const p = await createProduct('Referenced');
      const res = await stockIn(p.id, 10, {
        referenceType: 'PURCHASE',
        referenceId: 'PO-001',
      }).expect(201);
      expect(res.body.data.type).toBe('STOCK_IN');
      const mv = await prisma.stockMovement.findFirst({ where: { productId: p.id } });
      expect(mv?.referenceType).toBe('PURCHASE');
      expect(mv?.referenceId).toBe('PO-001');
    });

    it('large quantity boundary does not overflow', async () => {
      const p = await createProduct('Big Stock');
      const res = await stockIn(p.id, 999_999_999).expect(201);
      expect(res.body.data.afterStock).toBe(999_999_999);
    });
  });

  describe('POST /inventory/stock-out', () => {
    it('decreases product stock and records a movement', async () => {
      const p = await createProduct('StockOut Product');
      await stockIn(p.id, 10).expect(201);
      const res = await stockOut(p.id, 4).expect(201);
      expect(res.body.data.type).toBe('STOCK_OUT');
      expect(res.body.data.beforeStock).toBe(10);
      expect(res.body.data.afterStock).toBe(6);
      const refreshed = await prisma.product.findUnique({ where: { id: p.id } });
      expect(refreshed?.stock).toBe(6);
    });

    it('stock-out to exactly zero succeeds', async () => {
      const p = await createProduct('To Zero');
      await stockIn(p.id, 5).expect(201);
      const res = await stockOut(p.id, 5).expect(201);
      expect(res.body.data.afterStock).toBe(0);
      const refreshed = await prisma.product.findUnique({ where: { id: p.id } });
      expect(refreshed?.stock).toBe(0);
    });

    it('stock-out exceeding stock returns 400 INSUFFICIENT_STOCK', async () => {
      const p = await createProduct('Insufficient');
      await stockIn(p.id, 3).expect(201);
      const res = await stockOut(p.id, 4).expect(400);
      expect(res.body.error.message).toBe('INSUFFICIENT_STOCK');
    });

    it('failed stock-out leaves no movement and unchanged stock', async () => {
      const p = await createProduct('Rollback');
      await stockIn(p.id, 3).expect(201);
      await stockOut(p.id, 99).expect(400);
      const movements = await prisma.stockMovement.count({ where: { productId: p.id } });
      expect(movements).toBe(1); // only the stock-in, no stock-out row
      const refreshed = await prisma.product.findUnique({ where: { id: p.id } });
      expect(refreshed?.stock).toBe(3);
    });
  });

  describe('POST /inventory/adjust', () => {
    it('sets stock to absolute value', async () => {
      const p = await createProduct('Adjust Up');
      await stockIn(p.id, 5).expect(201);
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/adjust')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ productId: p.id, newStock: 8, reason: 'Opname' })
        .expect(201);
      expect(res.body.data.type).toBe('ADJUSTMENT');
      expect(res.body.data.beforeStock).toBe(5);
      expect(res.body.data.afterStock).toBe(8);
    });

    it('adjustment stores |after - before| as quantity', async () => {
      const p = await createProduct('Adjust Qty');
      await stockIn(p.id, 10).expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/inventory/adjust')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ productId: p.id, newStock: 4, reason: 'Broken' })
        .expect(201);
      const mv = await prisma.stockMovement.findFirst({
        where: { productId: p.id, type: 'ADJUSTMENT' },
      });
      expect(mv?.quantity).toBe(6);
      expect(mv?.beforeStock).toBe(10);
      expect(mv?.afterStock).toBe(4);
    });

    it('adjustment without reason returns 400', async () => {
      const p = await createProduct('No Reason');
      await request(app.getHttpServer())
        .post('/api/v1/inventory/adjust')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ productId: p.id, newStock: 3 })
        .expect(400);
    });

    it('negative newStock returns 400', async () => {
      const p = await createProduct('Neg Adjust');
      await request(app.getHttpServer())
        .post('/api/v1/inventory/adjust')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ productId: p.id, newStock: -1, reason: 'x' })
        .expect(400);
    });
  });

  describe('guards & errors', () => {
    it('mutation on unknown product returns 404', async () => {
      await stockIn('00000000-0000-0000-0000-000000000000', 5).expect(404);
    });

    it('mutation on soft-deleted product returns 404', async () => {
      const p = await createProduct('Deleted');
      await prisma.product.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
      await stockIn(p.id, 5).expect(404);
    });

    it('CASHIER cannot mutate stock', async () => {
      const p = await createProduct('Cashier Blocked');
      await request(app.getHttpServer())
        .post('/api/v1/inventory/stock-in')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ productId: p.id, quantity: 5 })
        .expect(403);
    });

    it('CASHIER can read inventory list', async () => {
      await createProduct('Cashier Read');
      const res = await request(app.getHttpServer())
        .get('/api/v1/inventory')
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);
      expect(res.body.data.items).toBeDefined();
    });
  });

  describe('GET /inventory', () => {
    it('lists products with current stock', async () => {
      const p = await createProduct('List Product');
      await stockIn(p.id, 15).expect(201);
      const res = await request(app.getHttpServer())
        .get('/api/v1/inventory')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const item = res.body.data.items.find((i: { id: string }) => i.id === p.id);
      expect(item.stock).toBe(15);
    });

    it('excludes soft-deleted products', async () => {
      const p = await createProduct('Ghost');
      await prisma.product.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
      const res = await request(app.getHttpServer())
        .get('/api/v1/inventory')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.some((i: { id: string }) => i.id === p.id)).toBe(false);
    });
  });

  describe('GET /inventory/:productId', () => {
    it('returns product with movements newest first', async () => {
      const p = await createProduct('Detail');
      await stockIn(p.id, 5).expect(201);
      await stockIn(p.id, 3).expect(201);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/inventory/${p.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(p.id);
      expect(res.body.data.movements.length).toBe(2);
      expect(res.body.data.movements[0].afterStock).toBe(8); // newest first
      expect(res.body.data.movements[1].afterStock).toBe(5);
    });

    it('unknown product returns 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/inventory/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });
});
