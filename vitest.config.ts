import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/out/**', '**/webview/**', '**/src/test/**'],
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      vscode: path.resolve(__dirname, 'src/test/vscode-mock.ts'),
    },
  },
});
