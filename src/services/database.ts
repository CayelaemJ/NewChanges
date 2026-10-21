import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Share one bounded pool across services. Preserve URL-provided pool limits
// while providing finite connection waits on small Render/Railway instances.
const url = process.env.DATABASE_URL;
const params = url ? new URL(url).searchParams : new URLSearchParams();
const positive = (value: string | null, fallback: number, max: number) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, max) : fallback;
};
const adapter = new PrismaPg({
  connectionString: url,
  max: positive(params.get('connection_limit'), 3, 20),
  connectionTimeoutMillis: positive(params.get('connect_timeout'), 5, 60) * 1000,
  idleTimeoutMillis: 30_000,
});
export const prisma = new PrismaClient({ adapter });
