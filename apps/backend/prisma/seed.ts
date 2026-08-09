import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  const adminPassword = await bcrypt.hash('admin123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@nexuspos.dev' },
    update: {
      passwordHash: adminPassword,
      role: Role.OWNER,
    },
    create: {
      email: 'admin@nexuspos.dev',
      name: 'NexusPOS Admin',
      passwordHash: adminPassword,
      role: Role.OWNER,
    },
  });

  console.log('✅ Seeded admin user: admin@nexuspos.dev / admin123 (OWNER)');
  console.log('🌱 Database seed completed.');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
