import { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { test, expect, openRoute } from './helpers';

// The DoomDemo view (route "/"): the Doom component plus toggle switches bound
// bidirectionally to data.controls.* and to the [default]Doom/Line/Running tag
// (state.paused is an expression on that tag: line stops, Doom pauses).
// DOM order of the toggles: fire, forward, turnLeft, use, lineRunning.
const TURN_LEFT = 2;
const LINE_RUNNING = 4;

const toggle = (page: Page, index: number) =>
    page.locator('[data-component="ia.input.toggle-switch"]').nth(index).locator('.ia_toggleSwitch');

async function startGame(page: Page) {
    const root = await openRoute(page, '/', '.mustry-doom');
    await expect(root).toHaveClass(/mustry-doom--idle/);
    await root.locator('.mustry-doom__splash').click();
    // Engine download + WAD preload + first tic. Generous: CI runners are slow.
    await expect(root).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
    await expect(page.getByText(/output\.state: running/)).toBeVisible();
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

test('doom: stopping the line (a tag) pauses the game through state.paused, restarting resumes it', async ({ page }) => {
    const root = await startGame(page);
    await toggle(page, LINE_RUNNING).click();
    await expect(root).toHaveClass(/mustry-doom--paused/);
    await expect(page.getByText(/output\.state: paused/)).toBeVisible();
    await toggle(page, LINE_RUNNING).click();
    await expect(root).toHaveClass(/mustry-doom--running/);
    await expect(page.getByText(/output\.state: running/)).toBeVisible();
});

test('doom: live telemetry reaches the outputs and the bound tags', async ({ page }) => {
    await startGame(page);
    // The marine starts E1M1 with 100 health and 50 bullets; the outputs are
    // polled from the engine and the view mirrors the bound tag values too.
    await expect(page.getByText(/output\.health: 100/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/output\.ammo: 50/)).toBeVisible();
    await expect(page.getByText(/output\.inLevel: true/)).toBeVisible();
    // Health reaches [default]Doom/Players/Player1/Health through a reference tag onto
    // the module's own [Doom] provider, which the component feeds with no bindings.
    await expect(page.getByText(/tag Player1\/Health: 100/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/\[Doom\]Players\/Player1\/Online: true/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/output\.player: Player1/)).toBeVisible();
});

test('doom: quitting from the in-game menu leaves a restartable component, Restart brings it back', async ({ page }) => {
    const root = await startGame(page);
    // Real keys through the focused canvas: Escape opens the menu, Quit Game is
    // the sixth entry, Enter asks "are you sure", y quits -> I_Quit -> exit().
    const canvas = page.locator('#canvas');
    await canvas.click();
    await page.keyboard.press('Escape');
    for (let i = 0; i < 5; i++) {
        await page.keyboard.press('ArrowDown');
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.press('y');
    await expect(root).toHaveClass(/mustry-doom--exited/, { timeout: 20_000 });
    await expect(page.getByText(/output\.state: exited/)).toBeVisible();
    await root.getByRole('button', { name: 'Restart' }).click();
    await expect(root).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
    await expect(page.getByText(/output\.state: running/)).toBeVisible();
});

test('doom: a save game made in Doom\'s menu survives a page reload via the gateway', async ({ page }) => {
    await startGame(page);
    const canvas = page.locator('#canvas');
    await canvas.click();
    // Escape -> menu; Save Game is the fourth entry; Enter opens the slots; Enter
    // on slot 1 starts editing its name; type a name; Enter saves. Doom handles
    // menu keys once per 35 Hz tick and only enables text input while the slot
    // editor is open, so each step gets a short pause or the typed keys are lost.
    const step = () => page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await step();
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('ArrowDown');
    }
    await step();
    await page.keyboard.press('Enter');
    await step();
    await page.keyboard.press('Enter');
    await step();
    // The slot editor starts with the previous name (Doom upper-cases it); clear it first.
    for (let i = 0; i < 24; i++) {
        await page.keyboard.press('Backspace');
    }
    await step();
    await page.keyboard.type('e2e save', { delay: 40 });
    await step();
    await page.keyboard.press('Enter');
    // The gateway answered with the user's slots: at least this one, owned by the
    // (unauthenticated) session's "anonymous" bucket.
    await expect(page.getByText(/last save: 1 "E2E SAVE"/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/output\.savedSlots: [1-6]/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/output\.saveOwner: anonymous/)).toBeVisible();

    // A fresh session: the gateway hands the slots back before the engine starts.
    await page.reload();
    const root = await openRoute(page, '/', '.mustry-doom');
    await expect(page.getByText(/output\.savedSlots: [1-6]/)).toBeVisible({ timeout: 20_000 });
    await root.locator('.mustry-doom__splash').click();
    await expect(root).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
    // The restored slot is readable by the engine: Load Game lists a non-empty slot 1.
    await canvas.click();
    await page.keyboard.press('Escape');
    for (let i = 0; i < 2; i++) {
        await page.keyboard.press('ArrowDown');
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter'); // load slot 1
    await expect(page.getByText(/output\.state: running/)).toBeVisible();
    await expect(page.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 15_000 });
});
