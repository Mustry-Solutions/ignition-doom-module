import { Page } from '@playwright/test';
import { readdirSync } from 'fs';
import path from 'path';
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

test('demo: the header pills report the Doom module, Embr Charts and whether a historian exists', async ({ page }) => {
    // The dev/CI gateway stages Embr Charts, so those two pills must be green.
    // The historian module comes from a private sibling repo: when it is
    // staged (ops/stage-historian.sh) fresh.sh seeds the "Doom Historian"
    // profile and the pill must be green; CI has none and must show the
    // degraded state instead. A wrong answer here means the detection broke
    // (0.1.2 shipped with history silently off because it called a
    // system.tag function that does not exist).
    const historianStaged = readdirSync(path.join(__dirname, '..', '..', 'ops', 'modules'))
        .some((f) => /historian/i.test(f) && f.endsWith('.modl'));
    await openRoute(page, '/', '.mustry-doom');
    await expect(page.getByText('\u2713 DOOM MODULE')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('\u2713 EMBR CHARTS')).toBeVisible();
    if (historianStaged) {
        await expect(page.getByText('\u2713 HISTORY')).toBeVisible();
        await expect(page.getByText(/MARINE VITALS \u00b7 DOOM HISTORIAN/)).toBeVisible();
    } else {
        await expect(page.getByText('\u2717 HISTORY')).toBeVisible();
        await expect(page.getByText(/MARINE VITALS \u00b7 NO HISTORIAN/)).toBeVisible();
        await expect(page.getByText(/Embr Charts is installed but this gateway has no tag history provider/)).toBeVisible();
    }
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

test('doom: an unauthenticated session keeps its saves in the tab, never in a shared gateway folder', async ({ page }) => {
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
    for (let i = 0; i < 24; i++) {
        await page.keyboard.press('Backspace');
    }
    await step();
    await page.keyboard.type('e2e save', { delay: 40 });
    await step();
    await page.keyboard.press('Enter');
    // The engine saved (slot 1, our name) but the verify project has no login,
    // so the gateway reports no owner and the component keeps the slot local.
    await expect(page.getByText(/last save: 1 "E2E SAVE"/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.mustry-doom__message')).toHaveText(/this tab only: log in/);
    await expect(page.getByText(/output\.savedSlots: 0/)).toBeVisible();
    await expect(page.getByText(/output\.saveOwner:\s+·\s+last save/)).toBeVisible();
});

test('relay: a WebSocket without a gateway-issued ticket is refused', async ({ page, consoleErrors }) => {
    // Straight from the page's origin, no component involved: the handshake
    // must fail (403). A ticketed one is exercised by the deathmatch test.
    await openRoute(page, '/', '.mustry-doom');
    const result = await page.evaluate(() => new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://${location.host}/system/doom-relay/e2e`);
        ws.onopen = () => { ws.close(); resolve('open'); };
        ws.onerror = () => resolve('error');
        ws.onclose = (e) => resolve(`closed ${e.code}`);
        setTimeout(() => resolve('timeout'), 10_000);
    }));
    expect(result).not.toBe('open');
    // The browser reports the refused handshake as a console error; that is the
    // expected outcome here, not a defect of the session.
    const refused = consoleErrors.findIndex((e) => /doom-relay\/e2e.*403/.test(e));
    expect(refused).toBeGreaterThanOrEqual(0);
    consoleErrors.splice(refused, 1);
});

test('deathmatch: two sessions meet through the gateway relay and both reach the map', async ({ browser, page: hostPage }) => {
    // Host in this test's page, joiner in a second browser context (its own
    // Perspective session). The host auto-launches at -nodes 2.
    const joinCtx = await browser.newContext();
    const joinPage = await joinCtx.newPage();
    try {
        const hostRoot = await openRoute(hostPage, '/arena/host/Player1/e2e', '.mustry-doom');
        await hostRoot.locator('.mustry-doom__splash').click();
        await expect(hostRoot).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
        // The host sits in the lobby until the second marine arrives.
        await expect(hostPage.getByText(/output\.inLobby: true/)).toBeVisible({ timeout: 30_000 });

        const joinRoot = await openRoute(joinPage, '/arena/join/Player2/e2e', '.mustry-doom');
        await joinRoot.locator('.mustry-doom__splash').click();
        await expect(joinRoot).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });

        // Both engines leave the lobby and enter E1M1 together.
        await expect(hostPage.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 60_000 });
        await expect(joinPage.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 60_000 });
        await expect(hostPage.getByText(/output\.player: Player1/)).toBeVisible();
        await expect(joinPage.getByText(/output\.player: Player2/)).toBeVisible();
        await expect(hostPage.getByText(/netPlayers: 2/)).toBeVisible({ timeout: 30_000 });

        // The relay's status route sees the arena: a server and one peer, no names.
        const status = await hostPage.evaluate(async () => {
            const r = await fetch('/system/doom-relay/');
            return { ok: r.ok, body: await r.json() as { arenas: { arena: string; server: boolean; peers: number }[] } };
        });
        expect(status.ok).toBe(true);
        const arena = status.body.arenas.find((a) => a.arena === 'e2e');
        expect(arena).toEqual({ arena: 'e2e', server: true, peers: 1 });
        expect(JSON.stringify(status.body)).not.toMatch(/Player[12]/);
    } finally {
        await joinCtx.close();
    }
});

// Operator-supplied WADs: ops/lib.sh seeds the gateway's wads folder with the
// shareware IWAD under the name doom.wad (the engine identifies IWADs by file
// name). The DoomWad view binds config.iwad / config.pwads to the route.
test('wads: an operator IWAD from the gateway folder runs, with a ticketed download', async ({ page, consoleErrors }) => {
    const root = await openRoute(page, '/wad/doom', '.mustry-doom');
    await root.locator('.mustry-doom__splash').click();
    await expect(root).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
    await expect(page.getByText(/output\.iwad: doom\s/)).toBeVisible();
    await expect(page.getByText(/output\.wadError:\s*\n/)).toBeVisible();
    await expect(page.getByText(/output\.availableWads: doom/)).toBeVisible();
    await expect(page.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 30_000 });
    // The download route itself is closed to anyone without a delegate-issued ticket.
    const status = await page.evaluate(async () => (await fetch('/data/mustry-doom/wads/doom.wad')).status);
    expect(status).toBe(403);
    // That refusal is the browser's console error here, not the session's.
    const refused = consoleErrors.findIndex((e) => /403/.test(e));
    expect(refused).toBeGreaterThanOrEqual(0);
    consoleErrors.splice(refused, 1);
});

test('wads: an IWAD the gateway does not have falls back to shareware and says so; a missing PWAD is skipped', async ({ page }) => {
    const root = await openRoute(page, '/wad/plutonia/nope', '.mustry-doom');
    await root.locator('.mustry-doom__splash').click();
    await expect(root).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
    await expect(page.getByText(/output\.iwad: doom1/)).toBeVisible();
    await expect(page.getByText(/IWAD "plutonia" is not in the gateway's wads folder; playing doom1/)).toBeVisible();
    await expect(page.getByText(/PWAD "nope" is not in the gateway's wads folder; skipped/)).toBeVisible();
    await expect(page.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 30_000 });
});

test('wads: a PWAD on shareware data is refused before the engine can die on it', async ({ page }) => {
    const root = await openRoute(page, '/wad/doom1/doom', '.mustry-doom');
    await root.locator('.mustry-doom__splash').click();
    await expect(root).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
    await expect(page.getByText(/PWADs need a registered IWAD/)).toBeVisible();
    await expect(page.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 30_000 });
});
