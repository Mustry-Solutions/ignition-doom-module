import { Page } from '@playwright/test';
import { test, expect, openRoute } from './helpers';

// Regenerates the README's pictures. Not part of the suite: run it on purpose,
// against a dev gateway with the games seeded (ops/fresh.sh after
// ops/fetch-hexen-demo.sh, and your own Strife WADs in engine/build/strife/):
//
//     SCREENSHOTS=1 npx playwright test screenshots
//
// Output lands in docs/images/. Games without their WAD are skipped.
const OUT = '../docs/images';
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to regenerate docs/images');
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

async function dismissSessionDialog(page: Page) {
    await page.keyboard.press('Escape').catch(() => undefined);
}

async function play(page: Page, route: string, seconds: number) {
    const root = await openRoute(page, route, '.mustry-doom');
    await dismissSessionDialog(page);
    await root.locator('.mustry-doom__splash').click();
    await expect(root).toHaveClass(/mustry-doom--(running|error)/, { timeout: 60_000 });
    const failed = await root.evaluate((el) => el.className.includes('mustry-doom--error'));
    test.skip(failed, `${route}: no IWAD on this gateway`);
    await expect(page.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 60_000 });
    // Give the canvas focus and look around a little so the frame is not the spawn wall.
    await root.locator('#canvas').click();
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(350);
    await page.keyboard.up('ArrowLeft');
    await page.waitForTimeout(seconds * 1000);
    return root;
}

// The README's animation: the joke in ten seconds. Frames are written as PNGs
// and ops/make-gif.py assembles them (no ffmpeg needed).
test('control room clip frames', async ({ page }) => {
    const frames = `${OUT}/clip`;
    const shot = (n: number) => page.screenshot({ path: `${frames}/${String(n).padStart(3, '0')}.png` });
    const root = await openRoute(page, '/doom/control-room', '.mustry-doom');
    await dismissSessionDialog(page);
    await root.locator('.mustry-doom__splash').click();
    await expect(root).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
    await expect(page.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1500);

    const toggle = (i: number) =>
        page.locator('[data-component="ia.input.toggle-switch"]').nth(i).locator('.ia_toggleSwitch');
    let n = 0;
    const hold = async (index: number, ticks: number) => {
        await toggle(index).click();
        for (let i = 0; i < ticks; i++) { await page.waitForTimeout(200); await shot(n++); }
        await toggle(index).click();
    };
    for (let i = 0; i < 4; i++) { await page.waitForTimeout(200); await shot(n++); }
    await hold(2, 8);   // turnLeft: the view swings
    await hold(0, 6);   // fire: the shotgun goes off
    await hold(4, 14);  // lineRunning off: the alarm goes active and the game pauses
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(200); await shot(n++); }
    // eslint-disable-next-line no-console
    console.log(`clip frames: ${n} in ${frames}`);
});

test('launcher', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 620 }); // four cards in one row
    await openRoute(page, '/', '.flex-container');
    await dismissSessionDialog(page);
    await expect(page.getByText('MUSTRY DOOM', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${OUT}/launcher.png` });
});

test('strife hub with the how-to', async ({ page }) => {
    await openRoute(page, '/strife', '.flex-container');
    await dismissSessionDialog(page);
    await expect(page.getByText('HOW TO PLAY', { exact: false })).toBeVisible();
    await page.screenshot({ path: `${OUT}/hub-strife.png`, fullPage: true });
});

for (const [game, route] of [['heretic', '/game/heretic'], ['hexen', '/game/hexen'], ['strife', '/game/strife']] as const) {
    test(`${game} in the component`, async ({ page }) => {
        const root = await play(page, route, 2);
        await root.screenshot({ path: `${OUT}/${game}.png` });
    });
}
