import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppModule } from '../../app.module';
import { HashService } from '../auth/hash.service';

/**
 * End-to-end tests for the Product Management module.
 * Uses the dedicated test database (ledgera_test):
 *   DATABASE_URL=postgresql://nexuspos:nexuspos_dev@localhost:5432/ledgera_test?schema=public pnpm --filter @ledgera/backend test
 */
describe('ProductsModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hash: HashService;
  let ownerToken: string;
  let cashierToken: string;
  let seq = 0;

  const email = (prefix: string) => `prod-${prefix}-${Date.now()}-${seq++}@ledgera.dev`;
  const sku = (prefix: string) => `SKU-${prefix.toUpperCase()}-${Date.now()}-${seq++}`;

  const login = async (em: string, password: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: em, password })
      .expect(200);
    return res.body.data.accessToken as string;
  };

  const makeProduct = (overrides: Record<string, unknown> = {}) => ({
    sku: sku('p'),
    name: 'Coffee Beans Arabica',
    purchasePrice: 50_000,
    sellingPrice: 75_000,
    ...overrides,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // Mirror production config (main.ts).
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    hash = app.get(HashService);
  });

  beforeEach(async () => {
    await prisma.product.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();

    const owner = await prisma.user.create({
      data: {
        email: email('owner'),
        name: 'Owner',
        passwordHash: await hash.hashPassword('ownerpass'),
        role: 'OWNER',
        isActive: true,
      },
    });
    const cashier = await prisma.user.create({
      data: {
        email: email('cashier'),
        name: 'Cashier',
        passwordHash: await hash.hashPassword('cashierpass'),
        role: 'CASHIER',
        isActive: true,
      },
    });

    ownerToken = await login(owner.email, 'ownerpass');
    cashierToken = await login(cashier.email, 'cashierpass');
  });

  afterAll(async () => {
    await prisma.product.deleteMany();
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /products', () => {
    it('OWNER creates a product', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct())
        .expect(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sku).toBeDefined();
      expect(Number(res.body.data.sellingPrice)).toBe(75_000);
    });

    it('duplicate SKU returns 409', async () => {
      const p = makeProduct();
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(p)
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(p)
        .expect(409);
    });

    it('duplicate barcode returns 409', async () => {
      const barcode = `BAR-${Date.now()}-${seq++}`;
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct({ barcode }))
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct({ barcode }))
        .expect(409);
    });

    it('selling price below purchase returns 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct({ purchasePrice: 100_000, sellingPrice: 50_000 }))
        .expect(400);
    });

    it('empty name returns 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct({ name: '' }))
        .expect(400);
    });

    it('CASHIER gets 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send(makeProduct())
        .expect(403);
    });
  });

  describe('GET /products', () => {
    it('lists products with pagination', async () => {
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/products')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send(makeProduct({ name: `Item ${i}` }))
          .expect(201);
      }
      const res = await request(app.getHttpServer())
        .get('/api/v1/products?page=1&limit=2')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBe(2);
      expect(res.body.data.meta.total).toBe(3);
      expect(res.body.data.meta.totalPages).toBe(2);
    });

    it('searches by name', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct({ name: 'UniqueSearchName' }))
        .expect(201);
      const res = await request(app.getHttpServer())
        .get('/api/v1/products?search=UniqueSearchName')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].name).toBe('UniqueSearchName');
    });

    it('CASHIER can read products', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct())
        .expect(201);
      const res = await request(app.getHttpServer())
        .get('/api/v1/products')
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBe(1);
    });

    it('excludes soft-deleted products', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct({ name: 'ToDelete' }))
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/api/v1/products/${created.body.data.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const res = await request(app.getHttpServer())
        .get('/api/v1/products?search=ToDelete')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBe(0);
    });
  });

  describe('GET /products/:id', () => {
    it('returns product detail', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct())
        .expect(201);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/products/${created.body.data.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(created.body.data.id);
    });

    it('unknown id returns 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/products/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('soft-deleted product returns 404', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct())
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/api/v1/products/${created.body.data.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/products/${created.body.data.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });

  describe('PATCH /products/:id', () => {
    it('OWNER updates a product', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct())
        .expect(201);
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${created.body.data.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Updated Name' })
        .expect(200);
      expect(res.body.data.name).toBe('Updated Name');
    });

    it('duplicate SKU on update returns 409', async () => {
      const p1 = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct())
        .expect(201);
      const p2 = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct())
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/v1/products/${p2.body.data.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ sku: p1.body.data.sku })
        .expect(409);
    });

    it('invalid price on update returns 400', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct())
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/v1/products/${created.body.data.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ sellingPrice: 10_000 })
        .expect(400);
    });

    it('CASHIER gets 403', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct())
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/v1/products/${created.body.data.id}`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ name: 'Nope' })
        .expect(403);
    });
  });

  describe('PATCH /products/:id/status', () => {
    it('deactivates a product', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct())
        .expect(201);
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/products/${created.body.data.id}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ isActive: false })
        .expect(200);
      expect(res.body.data.isActive).toBe(false);
    });
  });

  describe('DELETE /products/:id', () => {
    it('soft-deletes a product', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct())
        .expect(201);
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/products/${created.body.data.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.deletedAt).toBeDefined();
    });

    it('CASHIER gets 403', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(makeProduct())
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/api/v1/products/${created.body.data.id}`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(403);
    });
  });
});
