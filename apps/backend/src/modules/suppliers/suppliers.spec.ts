import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppModule } from '../../app.module';
import { HashService } from '../auth/hash.service';

/**
 * End-to-end tests for the Supplier Management module.
 * Uses the dedicated test database (ledgera_test):
 *   DATABASE_URL=postgresql://nexuspos:nexuspos_dev@localhost:5432/ledgera_test?schema=public pnpm --filter @ledgera/backend test
 */
describe('SuppliersModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hash: HashService;
  let ownerToken: string;
  let adminToken: string;
  let cashierToken: string;
  let seq = 0;

  const email = (prefix: string) =>
    `sup-${prefix.toLowerCase()}-${Date.now()}-${seq++}@ledgera.dev`;
  const name = () => `Supplier-${Date.now()}-${seq++}`;
  const supEmail = () => `sup-${Date.now()}-${seq++}@mail.co`;

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

  const createSupplier = (body: Record<string, unknown>, token = ownerToken) =>
    request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201)
      .then((r) => r.body.data.id as string);

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
    await prisma.supplier.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();

    const owner = await createUser('Owner', 'OWNER');
    const admin = await createUser('Admin', 'ADMIN');
    const cashier = await createUser('Cashier', 'CASHIER');

    ownerToken = await login(owner.email, 'password123');
    adminToken = await login(admin.email, 'password123');
    cashierToken = await login(cashier.email, 'password123');
  });

  afterAll(async () => {
    await prisma.supplier.deleteMany();
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /suppliers', () => {
    it('OWNER creates a supplier', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: name() })
        .expect(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBeDefined();
    });

    it('ADMIN can create too', async () => {
      await createSupplier({ name: name() }, adminToken);
    });

    it('duplicate name (active) returns 409', async () => {
      const n = name();
      await createSupplier({ name: n });
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: n })
        .expect(409);
    });

    it('duplicate name with different case / extra spaces returns 409', async () => {
      await createSupplier({ name: 'PT ABC' });
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'pt    abc' })
        .expect(409);
    });

    it('name may be reused after soft delete', async () => {
      const n = name();
      const id = await createSupplier({ name: n });
      await request(app.getHttpServer())
        .delete(`/api/v1/suppliers/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      await createSupplier({ name: n }); // no 409
    });

    it('duplicate email returns 409', async () => {
      const em = supEmail();
      await createSupplier({ name: name(), email: em });
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: name(), email: em })
        .expect(409);
    });

    it('email may be reused after soft delete', async () => {
      const em = supEmail();
      const id = await createSupplier({ name: name(), email: em });
      await request(app.getHttpServer())
        .delete(`/api/v1/suppliers/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      await createSupplier({ name: name(), email: em }); // no 409
    });

    it('many suppliers may share a null email', async () => {
      await createSupplier({ name: name() });
      await createSupplier({ name: name() });
      await createSupplier({ name: name() }); // no 409
    });

    it('invalid email format returns 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: name(), email: 'not-an-email' })
        .expect(400);
    });

    it('blank / whitespace-only name returns 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: '   ' })
        .expect(400);
    });

    it('name is trimmed and inner spaces collapsed', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: '  PT    ABC  ' })
        .expect(201);
      expect(res.body.data.name).toBe('PT ABC');
    });

    it('email is stored lowercase', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: name(), email: 'AB.CD@Mail.Co' })
        .expect(201);
      expect(res.body.data.email).toBe('ab.cd@mail.co');
    });

    it('duplicate phone is allowed', async () => {
      await createSupplier({ name: name(), phone: '08123' });
      await createSupplier({ name: name(), phone: '08123' }); // no 409
    });

    it('unknown field is rejected', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: name(), taxId: 'X' })
        .expect(400);
    });

    it('CASHIER gets 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ name: name() })
        .expect(403);
    });
  });

  describe('GET /suppliers', () => {
    it('lists suppliers with pagination', async () => {
      for (let i = 0; i < 3; i++) await createSupplier({ name: name() });
      const res = await request(app.getHttpServer())
        .get('/api/v1/suppliers?page=1&limit=2')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBe(2);
      expect(res.body.data.meta.total).toBe(3);
      expect(res.body.data.meta.totalPages).toBe(2);
    });

    it('searches by name', async () => {
      await createSupplier({ name: 'UniqueSearchSupplier' });
      const res = await request(app.getHttpServer())
        .get('/api/v1/suppliers?search=UniqueSearchSupplier')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].name).toBe('UniqueSearchSupplier');
    });

    it('searches by contactName', async () => {
      await createSupplier({ name: name(), contactName: 'FindMeContact' });
      const res = await request(app.getHttpServer())
        .get('/api/v1/suppliers?search=FindMeContact')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].contactName).toBe('FindMeContact');
    });

    it('filters by isActive', async () => {
      const id = await createSupplier({ name: name() });
      await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${id}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ isActive: false })
        .expect(200);
      const res = await request(app.getHttpServer())
        .get('/api/v1/suppliers?isActive=false')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].isActive).toBe(false);
    });

    it('CASHIER can read suppliers', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);
      expect(res.body.data.items).toBeDefined();
    });

    it('excludes soft-deleted suppliers', async () => {
      const id = await createSupplier({ name: name() });
      await request(app.getHttpServer())
        .delete(`/api/v1/suppliers/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const res = await request(app.getHttpServer())
        .get('/api/v1/suppliers?page=1&limit=100')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.some((i: { id: string }) => i.id === id)).toBe(false);
    });
  });

  describe('GET /suppliers/:id', () => {
    it('returns supplier detail', async () => {
      const id = await createSupplier({ name: name() });
      const res = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(id);
    });

    it('unknown id returns 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/suppliers/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('soft-deleted id returns 404', async () => {
      const id = await createSupplier({ name: name() });
      await request(app.getHttpServer())
        .delete(`/api/v1/suppliers/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });

  describe('PATCH /suppliers/:id', () => {
    it('OWNER updates a supplier', async () => {
      const id = await createSupplier({ name: name() });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Updated Supplier' })
        .expect(200);
      expect(res.body.data.name).toBe('Updated Supplier');
    });

    it('renaming to an existing name returns 409', async () => {
      const keep = name();
      await createSupplier({ name: keep });
      const other = await createSupplier({ name: name() });
      await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${other}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: keep })
        .expect(409);
    });

    it('email is normalized (trim + lowercase) on update', async () => {
      const id = await createSupplier({ name: name(), email: supEmail() });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: 'NEW.Upper@Mail.Co' })
        .expect(200);
      expect(res.body.data.email).toBe('new.upper@mail.co');
    });

    it('name is trimmed on update', async () => {
      const id = await createSupplier({ name: name() });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: '  PT    XYZ  ' })
        .expect(200);
      expect(res.body.data.name).toBe('PT XYZ');
    });

    it('CASHIER gets 403', async () => {
      const id = await createSupplier({ name: name() });
      await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${id}`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ name: 'Hijack' })
        .expect(403);
    });
  });

  describe('PATCH /suppliers/:id/status', () => {
    it('deactivates a supplier', async () => {
      const id = await createSupplier({ name: name() });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${id}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ isActive: false })
        .expect(200);
      expect(res.body.data.isActive).toBe(false);
    });
  });

  describe('DELETE /suppliers/:id', () => {
    it('soft deletes a supplier', async () => {
      const id = await createSupplier({ name: name() });
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/suppliers/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.deletedAt).toBeDefined();
    });

    it('CASHIER gets 403', async () => {
      const id = await createSupplier({ name: name() });
      await request(app.getHttpServer())
        .delete(`/api/v1/suppliers/${id}`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(403);
    });
  });
});
