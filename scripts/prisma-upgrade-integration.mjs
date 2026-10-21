import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Schema writes are allowed only against the disposable local CI database.
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
assert(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/newchanges_ci',
  'Prisma integration requires the disposable local newchanges_ci database');
const pushed = spawnSync('node', ['node_modules/prisma/build/index.js', 'db', 'push'], {stdio:'inherit'});
assert.equal(pushed.status, 0, 'Fresh schema deployment must succeed');
const {prisma} = await import('../dist/services/database.js');
try {
  const id = '__dependency_upgrade_fixture__';
  await prisma.employer.create({data:{id,name:'Synthetic dependency upgrade fixture'}});
  assert.equal((await prisma.employer.findUniqueOrThrow({where:{id}})).name, 'Synthetic dependency upgrade fixture');
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.employer.update({where:{id},data:{name:'Must roll back'}});
    throw new Error('synthetic rollback');
  }), /synthetic rollback/);
  assert.equal((await prisma.employer.findUniqueOrThrow({where:{id}})).name, 'Synthetic dependency upgrade fixture');
  const rows = await prisma.$queryRaw`SELECT ${42}::integer AS answer`;
  assert.equal(rows[0].answer,42);
  await prisma.employer.delete({where:{id}});
  assert.equal(await prisma.employer.count({where:{id}}),0);
  console.log('Prisma adapter: schema deployment, typed CRUD, parameterized SQL and transaction rollback passed.');
} finally { await prisma.$disconnect(); }
