import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppModule } from '../../app.module';
import { HashService } from '../auth/hash.service';

/**
 * End-to-end tests for the User Management module.
 * Uses a dedicated test database (ledgera_test) — run with:
 *   DATABASE_URL=postgresql://nexuspos:nexuspos_dev@localhost:5432/ledgera_test?schema=public pnpm --filter @ledgera/backend test
 */
describe('UsersModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hash: HashService;
  let ownerToken: string;
  let cashierToken: string;
  let seq = 0;

  const email = (prefix: string) => `test-${prefix}-${Date.now()}-${seq++}@ledgera.dev`;

  const login = async (email: string, password: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
  };

  const createUser = async (name: string, role: string) => {
    const em = email(name);
    const passwordHash = await hash.hashPassword('password123');
    const user = await prisma.user.create({
      data: { email: em, name, passwordHash, role: role as never, isActive: true },
    });
    return user;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // Mirror production config (main.ts) so tests behave like the real API.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    hash = app.get(HashService);
  });

  beforeEach(async () => {
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
    const admin = await prisma.user.create({
      data: {
        email: email('admin'),
        name: 'Admin',
        passwordHash: await hash.hashPassword('adminpass'),
        role: 'ADMIN',
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
    await login(admin.email, 'adminpass'); // admin exists as a role fixture
    cashierToken = await login(cashier.email, 'cashierpass');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /users', () => {
    it('OWNER can list users', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(3);
    });

    it('CASHIER receives 403', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(403);
    });

    it('supports search by email', async () => {
      await createUser('searchme', 'CASHIER');
      const res = await request(app.getHttpServer())
        .get('/api/v1/users?search=searchme')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].name).toBe('searchme');
    });

    it('supports pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users?page=1&limit=2')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBe(2);
      expect(res.body.data.meta.page).toBe(1);
      expect(res.body.data.meta.limit).toBe(2);
      expect(res.body.data.meta.totalPages).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /users/:id', () => {
    it('OWNER can view a user detail', async () => {
      const target = await createUser('detail', 'CASHIER');
      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${target.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(target.id);
    });

    it('unknown user returns 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });

  describe('PATCH /users/:id (profile)', () => {
    it('OWNER updates name', async () => {
      const target = await createUser('oldname', 'CASHIER');
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'newname' })
        .expect(200);
      expect(res.body.data.name).toBe('newname');
    });

    it('duplicate email returns 409', async () => {
      const a = await createUser('a', 'CASHIER');
      const b = await createUser('b', 'CASHIER');
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${b.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: a.email })
        .expect(409);
    });

    it('invalid DTO returns 400', async () => {
      const target = await createUser('bad', 'CASHIER');
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: 'not-an-email' })
        .expect(400);
    });

    it('role is rejected on profile endpoint', async () => {
      const target = await createUser('norole', 'CASHIER');
      // forbidNonWhitelisted: true → unknown field is a 400, not silently stripped
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'ADMIN' })
        .expect(400);
    });
  });

  describe('PATCH /users/:id/status', () => {
    it('OWNER deactivates a user', async () => {
      const target = await createUser('disableme', 'CASHIER');
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ isActive: false })
        .expect(200);
      expect(res.body.data.isActive).toBe(false);
    });

    it('deactivating the last OWNER returns 400', async () => {
      await prisma.user.deleteMany({ where: { role: { not: 'OWNER' } } });
      const lastOwner = await prisma.user.findFirstOrThrow({ where: { role: 'OWNER' } });
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${lastOwner.id}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ isActive: false })
        .expect(400);
    });

    it('self-deactivate returns 400', async () => {
      const owner = await prisma.user.findFirstOrThrow({ where: { role: 'OWNER' } });
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${owner.id}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ isActive: false })
        .expect(400);
    });

    it('invalid DTO returns 400', async () => {
      const target = await createUser('baddisable', 'CASHIER');
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ isActive: 'yes' })
        .expect(400);
    });
  });

  describe('PATCH /users/:id/role', () => {
    it('OWNER changes a role', async () => {
      const target = await createUser('promote', 'CASHIER');
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}/role`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'ADMIN' })
        .expect(200);
      expect(res.body.data.role).toBe('ADMIN');
    });

    it('downgrading the last OWNER returns 400', async () => {
      await prisma.user.deleteMany({ where: { role: { not: 'OWNER' } } });
      const lastOwner = await prisma.user.findFirstOrThrow({ where: { role: 'OWNER' } });
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${lastOwner.id}/role`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'ADMIN' })
        .expect(400);
    });

    it('self-downgrade returns 400', async () => {
      const owner = await prisma.user.findFirstOrThrow({ where: { role: 'OWNER' } });
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${owner.id}/role`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'CASHIER' })
        .expect(400);
    });

    it('CASHIER receives 403', async () => {
      const target = await createUser('target', 'CASHIER');
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}/role`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ role: 'ADMIN' })
        .expect(403);
    });
  });
});
