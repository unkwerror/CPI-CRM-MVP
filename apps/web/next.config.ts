import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { NextConfig } from 'next';

const workspaceRoot = resolve(process.cwd(), '../..');
const envFile = resolve(workspaceRoot, process.env.ENV_FILE ?? '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiTarget}/:path*`,
      },
    ];
  },
};

export default nextConfig;
