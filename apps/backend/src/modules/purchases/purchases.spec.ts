import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppModule } from '../../app.module';
import { HashService } from '../auth/hash.service';

/**
 * End-to-end tests for the Purchase Management module.
 * Uses the dedicated test database (ledgera_test):
 *   DATABASE_URL=postgresql://nexuspos:nexuspos_dev@localhost:5432/ledgera_test?schema=public pnpm --filter @ledgera/backend test
 */
describe('PurchasesModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hash: HashService;
  let ownerToken: string;
  let cashierToken: string;
  let seq = 0;

  const email = (prefix: string) =>
    `pur-${prefix.toLowerCase()}-${Date.now()}-${seq++}@ledgera.dev`;
  const sku = () => `PUR-${Date.now()}-${seq++}`;

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

  const createProduct = (n: string) =>
    prisma.product.create({
      data: { sku: sku(), name: n, purchasePrice: 1000, sellingPrice: 1500, stock: 0 },
    });

  const createSupplier = (n: string) => prisma.supplier.create({ data: { name: n } });

  const createPurchase = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/v1/purchases')
      .set('Authorization', `Bearer ${ownerToken}`)
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
    await prisma.purchaseItem.deleteMany();
    await prisma.purchase.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.product.deleteMany();
    await prisma.supplier.deleteMany();
    await prisma.category.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();

    const owner = await createUser('Owner', 'OWNER');
    const cashier = await createUser('Cashier', 'CASHIER');
    ownerToken = await login(owner.email, 'password123');
    cashierToken = await login(cashier.email, 'password123');
  });

  afterAll(async () => {
    await prisma.purchaseItem.deleteMany();
    await prisma.purchase.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /purchases', () => {
    it('creates a purchase and stocks in the items', async () => {
      const supplier = await createSupplier('Supplier A');
      const p1 = await createProduct('Hold A');
      const p2 = await createProduct('Hold B');

      const res = await createPurchase({
        supplierId: supplier.id,
        items: [
          { productId: p1.id, quantity: 10, unitPrice: 1000 },
          { productId: p2.id, quantity: 5, unitPrice: 2000 },
        ],
      }).expect(201);

      expect(res.body.data.status).toBe('RECEIVED');
      expect(Number(res.body.data.totalAmount)).toBe(20000); // 10×1000 + 5×2000

      const refreshed1 = await prisma.product.findUnique({ where: { id: p1.id } });
      const refreshed2 = await prisma.product.findUnique({ where: { id: p2.id } });
      expect(refreshed1?.stock).toBe(10);
      expect(refreshed2?.stock).toBe(5);

      const movements = await prisma.stockMovement.findMany({
        where: { referenceType: 'PURCHASE' },
      });
      expect(movements.length).toBe(2);
      expect(movements.every((m) => m.referenceId === res.body.data.id)).toBe(true);
    });

    it('snapshots supplierName and productName', async () => {
      const supplier = await createSupplier('Snapshot Supplier');
      const p = await createProduct('Snapshot Product');
      const res = await createPurchase({
        supplierId: supplier.id,
        items: [{ productId: p.id, quantity: 2, unitPrice: 500 }],
      }).expect(201);

      expect(res.body.data.supplierName).toBe('Snapshot Supplier');
      const created = await prisma.purchase.findUnique({
        where: { id: res.body.data.id },
        include: { items: true },
      });
      expect(created?.items[0].productName).toBe('Snapshot Product');
    });

    it('supplier not found returns 404 (no stock change)', async () => {
      const p = await createProduct('No Supplier');
      await createPurchase({
        supplierId: '00000000-0000-0000-0000-000000000000',
        items: [{ productId: p.id, quantity: 3, unitPrice: 500 }],
      }).expect(404);

      const refreshed = await prisma.product.findUnique({ where: { id: p.id } });
      expect(refreshed?.stock).toBe(0);
      expect(await prisma.purchase.count()).toBe(0);
    });

    it('product not found returns 404 with full rollback', async () => {
      const supplier = await createSupplier('Rollback Supplier');
      const good = await createProduct('Good');
      await createPurchase({
        supplierId: supplier.id,
        items: [
          { productId: good.id, quantity: 3, unitPrice: 500 },
          { productId: '00000000-0000-0000-0000-000000000000', quantity: 1, unitPrice: 100 },
        ],
      }).expect(404);

      expect(await prisma.purchase.count()).toBe(0);
      expect(await prisma.purchaseItem.count()).toBe(0);
      expect(await prisma.stockMovement.count({ where: { referenceType: 'PURCHASE' } })).toBe(0);
    });

    it('empty items returns 400', async () => {
      await createPurchase({ items: [] }).expect(400);
    });

    it('duplicate product in items returns 400', async () => {
      const p = await createProduct('Duplicate');
      await createPurchase({
        items: [
          { productId: p.id, quantity: 1, unitPrice: 100 },
          { productId: p.id, quantity: 2, unitPrice: 100 },
        ],
      }).expect(400);
    });

    it('soft-deleted product returns 404', async () => {
      const p = await createProduct('Ghost');
      await prisma.product.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
      await createPurchase({ items: [{ productId: p.id, quantity: 1, unitPrice: 100 }] }).expect(
        404,
      );
    });

    it('inactive product returns 404', async () => {
      const p = await createProduct('Disabled');
      await prisma.product.update({ where: { id: p.id }, data: { isActive: false } });
      await createPurchase({ items: [{ productId: p.id, quantity: 1, unitPrice: 100 }] }).expect(
        404,
      );
    });

    it('quantity 0 or negative returns 400', async () => {
      const p = await createProduct('Bad Qty');
      await createPurchase({ items: [{ productId: p.id, quantity: 0, unitPrice: 100 }] }).expect(
        400,
      );
      await createPurchase({ items: [{ productId: p.id, quantity: -1, unitPrice: 100 }] }).expect(
        400,
      );
    });

    it('negative unitPrice returns 400', async () => {
      const p = await createProduct('Bad Price');
      await createPurchase({ items: [{ productId: p.id, quantity: 1, unitPrice: -100 }] }).expect(
        400,
      );
    });

    it('CASHIER cannot create purchase', async () => {
      const p = await createProduct('Cashier Blocked');
      await request(app.getHttpServer())
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ items: [{ productId: p.id, quantity: 1, unitPrice: 100 }] })
        .expect(403);
    });

    it('creates referenceNo', async () => {
      const p = await createProduct('Reference');
      const res = await createPurchase({
        items: [{ productId: p.id, quantity: 1, unitPrice: 100 }],
      }).expect(201);
      expect(res.body.data.referenceNo).toMatch(/^PO-/);
    });
  });

  describe('GET /purchases', () => {
    it('lists purchases with pagination', async () => {
      const p = await createProduct('List');
      for (let i = 0; i < 3; i++) {
        await createPurchase({ items: [{ productId: p.id, quantity: 1, unitPrice: 100 }] }).expect(
          201,
        );
      }
      const res = await request(app.getHttpServer())
        .get('/api/v1/purchases?page=1&limit=2')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBe(2);
      expect(res.body.data.meta.total).toBe(3);
    });

    it('searches by supplierName', async () => {
      const supplier = await createSupplier('UniqueSearchSupplier');
      const p = await createProduct('By Supplier');
      await createPurchase({
        supplierId: supplier.id,
        items: [{ productId: p.id, quantity: 1, unitPrice: 100 }],
      }).expect(201);
      const res = await request(app.getHttpServer())
        .get('/api/v1/purchases?search=UniqueSearchSupplier')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBe(1);
    });

    it('CASHIER can read purchases', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/purchases')
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);
      expect(res.body.data.items).toBeDefined();
    });
  });

  describe('GET /purchases/:id', () => {
    it('returns purchase detail with items', async () => {
      const p = await createProduct('Detail');
      const res = await createPurchase({
        items: [{ productId: p.id, quantity: 2, unitPrice: 300 }],
      }).expect(201);
      const detail = await request(app.getHttpServer())
        .get(`/api/v1/purchases/${res.body.data.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(detail.body.data.items.length).toBe(1);
      expect(Number(detail.body.data.items[0].totalAmount)).toBe(600);
    });

    it('unknown id returns 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/purchases/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });
});
