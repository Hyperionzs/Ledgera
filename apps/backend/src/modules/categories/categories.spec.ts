import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppModule } from '../../app.module';
import { HashService } from '../auth/hash.service';

/**
 * End-to-end tests for the Category Management module.
 * Uses the dedicated test database (ledgera_test):
 *   DATABASE_URL=postgresql://nexuspos:nexuspos_dev@localhost:5432/ledgera_test?schema=public pnpm --filter @ledgera/backend test
 */
describe('CategoriesModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hash: HashService;
  let ownerToken: string;
  let adminToken: string;
  let cashierToken: string;
  let seq = 0;

  const email = (prefix: string) =>
    `cat-${prefix.toLowerCase()}-${Date.now()}-${seq++}@ledgera.dev`;
  const name = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;

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

  /** Creates a category through the API and returns its id. */
  const createCategory = (body: Record<string, unknown>, token = ownerToken) =>
    request(app.getHttpServer())
      .post('/api/v1/categories')
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
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
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
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /categories', () => {
    it('OWNER creates a root category', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: name('Electronics') })
        .expect(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBeDefined();
      expect(res.body.data.parentId).toBeNull();
    });

    it('ADMIN can create too', async () => {
      await createCategory({ name: name('AdminCat') }, adminToken);
    });

    it('duplicate root name (active) returns 409', async () => {
      const n = name('DupRoot');
      await createCategory({ name: n });
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: n })
        .expect(409);
    });

    it('root name may be reused after soft delete', async () => {
      const n = name('Promo');
      const id = await createCategory({ name: n });
      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      await createCategory({ name: n }); // no 409
    });

    it('duplicate child name under same parent returns 409', async () => {
      const root = await createCategory({ name: name('Food') });
      const n = name('Snack');
      await createCategory({ name: n, parentId: root });
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: n, parentId: root })
        .expect(409);
    });

    it('same name under different parents is allowed', async () => {
      const a = await createCategory({ name: name('StoreA') });
      const b = await createCategory({ name: name('StoreB') });
      const n = name('Shared');
      await createCategory({ name: n, parentId: a });
      await createCategory({ name: n, parentId: b }); // no 409
    });

    it('parent that does not exist returns 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: name('Orphan'), parentId: '00000000-0000-0000-0000-000000000000' })
        .expect(400);
    });

    it('parent that is soft-deleted returns 400', async () => {
      const parent = await createCategory({ name: name('GoneParent') });
      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${parent}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: name('Child'), parentId: parent })
        .expect(400);
    });

    it('empty name returns 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: '' })
        .expect(400);
    });

    it('unknown field is rejected', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: name('Strict'), color: 'red' })
        .expect(400);
    });

    it('CASHIER gets 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ name: name('Nope') })
        .expect(403);
    });
  });

  describe('GET /categories', () => {
    it('returns a nested tree', async () => {
      const root = await createCategory({ name: name('Electronics') });
      await createCategory({ name: name('Laptop'), parentId: root });
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      const match = res.body.data.items.find((i: { id: string }) => i.id === root);
      expect(match).toBeDefined();
      expect(match.children.length).toBe(1);
      expect(match.children[0].parentId).toBe(root);
    });

    it('empty tree returns empty items', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items).toEqual([]);
    });

    it('filters by search (name only)', async () => {
      await createCategory({ name: 'UniqueSearchTarget' });
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories?search=UniqueSearchTarget')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].name).toBe('UniqueSearchTarget');
    });

    it('CASHIER can read the tree', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);
      expect(res.body.data.items).toBeDefined();
    });

    it('excludes soft-deleted categories', async () => {
      const c = await createCategory({ name: name('ToDeleteCat') });
      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${c}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.items.some((i: { id: string }) => i.id === c)).toBe(false);
    });
  });

  describe('GET /categories/:id', () => {
    it('returns detail with parent, children and counts', async () => {
      const root = await createCategory({ name: name('DetailRoot') });
      const child = await createCategory({ name: name('DetailChild'), parentId: root });
      const res = await request(app.getHttpServer())
        .get(`/api/v1/categories/${root}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(root);
      expect(res.body.data.childCount).toBe(1);
      expect(res.body.data.children.length).toBe(1);
      expect(res.body.data.productCount).toBe(0);
      expect(res.body.data.parent).toBeNull();

      const childRes = await request(app.getHttpServer())
        .get(`/api/v1/categories/${child}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(childRes.body.data.parent.id).toBe(root);
    });

    it('unknown id returns 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/categories/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('soft-deleted id returns 404', async () => {
      const c = await createCategory({ name: name('GoneDetail') });
      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${c}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/categories/${c}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });

  describe('PATCH /categories/:id', () => {
    it('OWNER renames a category', async () => {
      const c = await createCategory({ name: name('OldName') });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${c}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'NewName' })
        .expect(200);
      expect(res.body.data.name).toBe('NewName');
    });

    it('renaming to a duplicate within the same parent returns 409', async () => {
      const root = await createCategory({ name: name('RenameDupRoot') });
      const keepName = name('KeepName');
      await createCategory({ name: keepName, parentId: root });
      const renamed = await createCategory({ name: name('RenameMe'), parentId: root });
      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${renamed}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: keepName })
        .expect(409);
    });

    it('renaming to the name of a sibling root returns 409', async () => {
      const nameA = name('SiblingA');
      const nameB = name('SiblingB');
      await createCategory({ name: nameA });
      const b = await createCategory({ name: nameB });
      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${b}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: nameA })
        .expect(409);
    });

    it('moves a category under a new parent', async () => {
      const root = await createCategory({ name: name('MoveRoot') });
      const moving = await createCategory({ name: name('Moving') });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${moving}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ parentId: root })
        .expect(200);
      expect(res.body.data.parentId).toBe(root);
    });

    it('moves a category back to root (parentId null)', async () => {
      const root = await createCategory({ name: name('RootA') });
      const child = await createCategory({ name: name('ChildA'), parentId: root });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${child}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ parentId: null })
        .expect(200);
      expect(res.body.data.parentId).toBeNull();
    });

    it('setting parent to itself returns 400', async () => {
      const c = await createCategory({ name: name('SelfParent') });
      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${c}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ parentId: c })
        .expect(400);
    });

    it('setting parent to its own descendant returns 400', async () => {
      const grand = await createCategory({ name: name('Grand') });
      const parent = await createCategory({ name: name('Parent'), parentId: grand });
      const child = await createCategory({ name: name('Child'), parentId: parent });
      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${parent}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ parentId: child })
        .expect(400);
    });

    it('CASHIER gets 403', async () => {
      const c = await createCategory({ name: name('Locked') });
      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${c}`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ name: 'Hijack' })
        .expect(403);
    });
  });

  describe('PATCH /categories/:id/status', () => {
    it('deactivates a category', async () => {
      const c = await createCategory({ name: name('Toggle') });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${c}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ isActive: false })
        .expect(200);
      expect(res.body.data.isActive).toBe(false);
    });

    it('deactivating a parent does NOT cascade to children', async () => {
      const root = await createCategory({ name: name('ParentToggle') });
      const child = await createCategory({ name: name('ChildToggle'), parentId: root });
      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${root}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ isActive: false })
        .expect(200);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/categories/${child}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.isActive).toBe(true);
    });
  });

  describe('DELETE /categories/:id', () => {
    it('soft deletes a root AND cascades to its children', async () => {
      const root = await createCategory({ name: name('CascadeRoot') });
      const child = await createCategory({ name: name('CascadeChild'), parentId: root });
      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${root}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      // Root is gone…
      await request(app.getHttpServer())
        .get(`/api/v1/categories/${root}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
      // …and so is the child.
      await request(app.getHttpServer())
        .get(`/api/v1/categories/${child}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('refuses to delete a category in use by a product', async () => {
      const c = await createCategory({ name: name('InUse') });
      await prisma.product.create({
        data: {
          sku: `SKU-INUSE-${Date.now()}-${seq++}`,
          name: 'Uses Category',
          purchasePrice: 10_000,
          sellingPrice: 15_000,
          categoryId: c,
        },
      });
      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${c}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);
    });

    it('refuses to delete when a descendant is in use', async () => {
      const root = await createCategory({ name: name('InUseDescendant') });
      const child = await createCategory({ name: name('InUseChild'), parentId: root });
      await prisma.product.create({
        data: {
          sku: `SKU-INUSE2-${Date.now()}-${seq++}`,
          name: 'Uses Child',
          purchasePrice: 20_000,
          sellingPrice: 25_000,
          categoryId: child,
        },
      });
      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${root}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);
    });

    it('CASHIER gets 403', async () => {
      const c = await createCategory({ name: name('LockedDelete') });
      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${c}`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(403);
    });
  });
});
