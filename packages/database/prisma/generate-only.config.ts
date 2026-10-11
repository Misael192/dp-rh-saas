import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolve } from 'node:path';

if (!process.argv.some((argument) => ['generate', 'format', 'validate'].includes(argument))) {
  throw new Error('Este arquivo é exclusivo para generate/format/validate; migrations devem usar a configuração padrão.');
}
// The schema parser resolves env("DATABASE_URL") during generation. This local
// placeholder is used only when no database URL is present; no connection runs.
process.env.DATABASE_URL ??= 'postgresql://generate:generate@127.0.0.1:5432/generate';

// Generation only: the CLI's schema engine adapter avoids downloading a native
// executable for this command. Database migrations still use the standard CLI
// and schema.prisma, with DATABASE_ADMIN_URL supplied as DATABASE_URL.
// No query, schema push, migration or database connection runs during generation.
export default defineConfig({
  schema: resolve(__dirname, 'schema.prisma'),
  experimental: { adapter: true },
  engine: 'js',
  adapter: async () => new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
});
