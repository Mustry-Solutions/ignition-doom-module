import { defineConfig } from '@playwright/test';

// Where the dev gateway is published. Matches GATEWAY_HTTP_PORT in ../.env
// (ops/e2e.sh exports E2E_BASE_URL from the same source of truth).
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:9188';

export default defineConfig({
    testDir: './tests',
    // One engine per page and 64 MB of wasm memory per session: run serially.
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        // Headless Chromium needs these for WebGL + WebAudio without a GPU/user gesture.
        launchOptions: {
            args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required']
        }
    },
});
