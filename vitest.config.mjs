import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['key-panel.test.ts'], maxWorkers: 2 } });
