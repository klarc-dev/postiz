// Klarc fork patch tests. Kept in its own file so upstream jest/nx config is
// never edited and upstream merges cannot conflict with it.
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/apps/frontend/src/components/new-launch/wordpress.update.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/youtube.provider.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/dtos/posts/providers-settings/youtube.settings.dto.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/wordpress.provider.spec.ts',
    '<rootDir>/apps/orchestrator/src/wait-for-temporal.spec.ts',
    '<rootDir>/libraries/helpers/src/utils/sanitize.post.content.spec.ts',
  ],
  transform: {
    '^.+\\.(?:[jt]s|mjs)$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: {
          allowJs: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          module: 'commonjs',
          target: 'es2020',
        },
      },
    ],
  },
  // DOMPurify's server-side jsdom dependencies include ESM, also on Node 22.
  // Transform only this dependency chain rather than all of node_modules.
  transformIgnorePatterns: [
    'node_modules/(?!(?:@exodus/bytes|isomorphic-dompurify|parse5|entities|@asamuzakjp|@csstools)/)',
  ],
  moduleNameMapper: {
    '^@gitroom/nestjs-libraries/(.*)$': '<rootDir>/libraries/nestjs-libraries/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
    '^@gitroom/plugins/(.*)$': '<rootDir>/libraries/plugins/src/$1',
    '^@gitroom/orchestrator/(.*)$': '<rootDir>/apps/orchestrator/src/$1',
  },
};
