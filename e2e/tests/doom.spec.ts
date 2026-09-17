import { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { test, expect, openRoute } from './helpers';

// The DoomDemo view (route "/"): the Doom component plus toggle switches bound
// bidirectionally to data.controls.* and state.paused. DOM order of the
// toggles: fire, forward, turnLeft, use, paused.
const TURN_LEFT = 2;
const PAUSED = 4;

const toggle = (page: Page, index: number) =>
    page.locator('[data-component="ia.input.toggle-switch"]').nth(index).locator('.ia_toggleSwitch');

async function startGame(page: Page) {
    const root = await openRoute(page, '/', '.mustry-doom');
    await expect(root).toHaveClass(/mustry-doom--idle/);
    await root.locator('.mustry-doom__splash').click();
    // Engine download + WAD preload + first tic. Generous: CI runners are slow.
    await expect(root).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
    await expect(page.getByText('output.state: running')).toBeVisible();
    return root;
}

/** Fraction of pixels whose colour differs noticeably between two PNGs of equal size. */
function changedFraction(a: Buffer, b: Buffer): number {
    const pa = PNG.sync.read(a);
    const pb = PNG.sync.read(b);
    if (pa.width !== pb.width || pa.height !== pb.height) {
        return 1;
    }
    const n = pa.width * pa.height;
    let changed = 0;
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const d = Math.abs(pa.data[o] - pb.data[o]) + Math.abs(pa.data[o + 1] - pb.data[o + 1]) + Math.abs(pa.data[o + 2] - pb.data[o + 2]);
        if (d > 48) {
            changed++;
        }
    }
    return changed / n;
}

test('doom: splash is idle, click starts the engine, SDL sizes the canvas, the tab title survives', async ({ page }) => {
    const root = await startGame(page);
    // SDL must have found the canvas (id="canvas") and sized its backing store
    // to the CSS box times devicePixelRatio; an untouched canvas is 300x150.
    const size = await page.locator('#canvas').evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height }));
    expect(size.w).toBeGreaterThanOrEqual(600);
    expect(size.h).toBeGreaterThanOrEqual(400);
    await expect(root.locator('.mustry-doom__state')).toHaveText('running');
    // SDL renames the document; the component puts Perspective's title back.
    await expect(page).toHaveTitle('verify');
});

test('doom: a tag-bound control reaches the engine (turn left changes the frame)', async ({ page }) => {
    await startGame(page);
    const canvas = page.locator('#canvas');
    // Let the first frames settle, then measure how much the picture changes on
    // its own (the status-bar face blinks; the view itself is static).
    await page.waitForTimeout(1500);
    const before = await canvas.screenshot();
    await page.waitForTimeout(800);
    const still = await canvas.screenshot();
    const idle = changedFraction(before, still);
    expect(idle, 'an idle view should barely change').toBeLessThan(0.15);

    await toggle(page, TURN_LEFT).click();
    await page.waitForTimeout(1200);
    const turned = await canvas.screenshot();
    await toggle(page, TURN_LEFT).click();
    const moved = changedFraction(still, turned);
    expect(moved, 'holding turnLeft via the binding must rotate the view').toBeGreaterThan(0.3);
});

test('doom: state.paused pauses and resumes through the binding', async ({ page }) => {
    const root = await startGame(page);
    await toggle(page, PAUSED).click();
    await expect(root).toHaveClass(/mustry-doom--paused/);
    await expect(page.getByText('output.state: paused')).toBeVisible();
    await toggle(page, PAUSED).click();
    await expect(root).toHaveClass(/mustry-doom--running/);
    await expect(page.getByText('output.state: running')).toBeVisible();
});
