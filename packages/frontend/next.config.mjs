/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@mental-load/contracts'],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
