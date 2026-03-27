import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse'],
  experimental: {
    serverActions: {
      bodySizeLimit: '150mb',
    },
  },
  middlewareClientMaxBodySize: '150mb',
}

export default nextConfig
