import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@mental-load/contracts'],
  // Provide version fallbacks for local dev (NEXT_PUBLIC_* are inlined at build time).
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION ?? pkg.version,
    NEXT_PUBLIC_APP_COMMIT: process.env.NEXT_PUBLIC_APP_COMMIT ?? 'local',
    NEXT_PUBLIC_DEPLOY_TIME: process.env.NEXT_PUBLIC_DEPLOY_TIME ?? '',
  },
};

export default nextConfig;
