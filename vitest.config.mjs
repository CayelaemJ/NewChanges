import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['quality-tests/**/*.test.js'], environment: 'node' } });
