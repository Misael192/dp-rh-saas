#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
try {
  const source = await readFile(new URL('../postgres/apply-runtime-grants.sql', import.meta.url), 'utf8');
  const statements = source.replace(/^\\.*$/gm, '').replace(/--.*$/gm, '')
    .split(';').map(value => value.trim()).filter(Boolean)
    .filter(value => !['BEGIN', 'COMMIT'].includes(value));
  await db.$transaction(async transaction => {
    for (const statement of statements) await transaction.$executeRawUnsafe(statement);
  });
  console.log('Explicit runtime grants applied.');
} catch (error) {
  console.error(`Runtime grants failed (${error.code ?? error.name ?? 'database error'}).`);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
