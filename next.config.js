/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lighthouse와 관련 패키지를 webpack에서 제외
  webpack: (config, { isServer }) => {
    if (isServer) {
      // 서버 사이드에서만 적용
      // Lighthouse와 chrome-launcher는 ESM 모듈이므로 webpack 번들링에서 완전히 제외
      const externalPackages = ['lighthouse', 'aiseo-audit']
      
      // externals를 함수로 만들어서 더 정확하게 처리
      const originalExternals = config.externals
      config.externals = [
        ...(Array.isArray(originalExternals) ? originalExternals : [originalExternals].filter(Boolean)),
        ({ request }, callback) => {
          if (externalPackages.includes(request)) {
            return callback(null, `commonjs ${request}`)
          }
          if (typeof originalExternals === 'function') {
            return originalExternals({ request }, callback)
          }
          callback()
        }
      ]
    }
    return config
  },
  experimental: {
    serverComponentsExternalPackages: ['lighthouse', 'puppeteer', 'puppeteer-core', 'aiseo-audit'],
  },
}

module.exports = nextConfig
