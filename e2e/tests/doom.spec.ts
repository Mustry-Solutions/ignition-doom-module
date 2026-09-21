import { Page } from '@playwright/test';
import { readdirSync } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { test, expect, openRoute } from './helpers';

// The DoomDemo view (route "/doom/control-room"): the Doom component plus toggle switches bound
// bidirectionally to data.controls.* and to the [default]Doom/Line/Running tag
// (state.paused is an expression on that tag: line stops, Doom pauses).
// DOM order of the toggles: fire, forward, turnLeft, use, lineRunning.
const TURN_LEFT = 2;
const LINE_RUNNING = 4;

const toggle = (page: Page, index: number) =>
    page.locator('[data-component="ia.input.toggle-switch"]').nth(index).locator('.ia_toggleSwitch');

async function startGame(page: Page) {
    const root = await openRoute(page, '/doom/control-room', '.mustry-doom');
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
    await openRoute(page, '/doom/control-room', '.mustry-doom');
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
    await openRoute(page, '/doom/control-room', '.mustry-doom');
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

// Heretic: the second Chocolate Doom family member, its own engine build and
// shareware IWAD served from mounted/heretic/. The DoomWad view binds
// config.game to the /game/:game route.
test('heretic: config.game = heretic runs the Heretic engine and its shareware episode', async ({ page }) => {
    const root = await openRoute(page, '/game/heretic', '.mustry-doom');
    await root.locator('.mustry-doom__splash').click();
    await expect(root).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
    await expect(page.getByText(/output\.iwad: heretic1/)).toBeVisible();
    await expect(page.getByText(/output\.wadError:\s*output\.availableWads/)).toBeVisible();
    await expect(page.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/episode: 1\s+·\s+map: 1/)).toBeVisible();
    // The engine came from the Heretic bundle, not Doom's.
    const heretic = await page.evaluate(() =>
        Array.from(document.scripts).some((s) => s.src.includes('/res/mustry-doom/heretic/websockets-heretic.js')));
    expect(heretic).toBe(true);
});

test('heretic: deathmatch through the same relay, both marines reach E1M1', async ({ browser, page: hostPage }) => {
    const joinCtx = await browser.newContext();
    const joinPage = await joinCtx.newPage();
    try {
        const hostRoot = await openRoute(hostPage, '/arena/host/Corvus1/htic/heretic', '.mustry-doom');
        await hostRoot.locator('.mustry-doom__splash').click();
        await expect(hostRoot).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
        await expect(hostPage.getByText(/output\.inLobby: true/)).toBeVisible({ timeout: 30_000 });

        const joinRoot = await openRoute(joinPage, '/arena/join/Corvus2/htic/heretic', '.mustry-doom');
        await joinRoot.locator('.mustry-doom__splash').click();
        await expect(joinRoot).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });

        await expect(hostPage.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 60_000 });
        await expect(joinPage.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 60_000 });
        await expect(hostPage.getByText(/netPlayers: 2/)).toBeVisible({ timeout: 30_000 });
        const heretic = await joinPage.evaluate(() =>
            Array.from(document.scripts).some((s) => s.src.includes('websockets-heretic.js')));
        expect(heretic).toBe(true);
    } finally {
        await joinCtx.close();
    }
});

// The launcher at / and the per-game hubs (ops/verify/tools/build_launcher.py).
test('launcher: every game has a card, the hubs list their sections, and the links navigate', async ({ page }) => {
    await openRoute(page, '/', '.flex-container');
    await expect(page.getByText('MUSTRY DOOM', { exact: true })).toBeVisible({ timeout: 30_000 });
    for (const game of ['DOOM', 'HERETIC', 'HEXEN', 'STRIFE']) {
        await expect(page.getByText(game, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('SHIPS', { exact: true })).toHaveCount(2);
    await expect(page.getByText('NEEDS YOUR WAD', { exact: true })).toHaveCount(2);
    await expect(page.getByText('PLANNED', { exact: true })).toHaveCount(0);

    // Card link -> the control room, whose DOOM title leads back to the launcher.
    await page.getByText('Control room', { exact: true }).click();
    await expect(page.locator('.mustry-doom')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/doom\/control-room$/);
    await page.getByText('DOOM', { exact: true }).first().click();
    await expect(page.getByText('MUSTRY DOOM', { exact: true })).toBeVisible({ timeout: 30_000 });

    // Hubs: one per shipping game, section cards carry their routes.
    await page.getByText('Overview →').first().click();
    await expect(page).toHaveURL(/\/doom$/);
    await expect(page.getByText('/doom/control-room', { exact: true })).toBeVisible();
    await expect(page.getByText('/arena/host/Player1/default/doom', { exact: true })).toBeVisible();
    await page.getByText('← All games').click();
    await page.getByText('Overview →').nth(1).click();
    await expect(page).toHaveURL(/\/heretic$/);
    await expect(page.getByText('/arena/host/Corvus1/htic/heretic', { exact: true })).toBeVisible();
    await page.getByText('Play', { exact: true }).click();
    await expect(page).toHaveURL(/\/game\/heretic$/);
    await expect(page.locator('.mustry-doom')).toBeVisible({ timeout: 30_000 });
});

// Hexen ships its engine but no IWAD (the demo carries no licence to ship it).
// The dev gateway has the 4-level demo when ops/fetch-hexen-demo.sh ran before
// fresh.sh; otherwise these tests skip rather than fail. The probe reads the
// gateway's wads listing through the DoomWad view's output.availableWads.
async function skipWithoutHexen(page: Page) {
    const root = await openRoute(page, '/game/hexen', '.mustry-doom');
    await root.locator('.mustry-doom__splash').click();
    const listing = page.getByText(/output\.availableWads: \S/).first();
    await expect(listing).toBeVisible({ timeout: 60_000 });
    const text = (await listing.textContent()) || '';
    const wads = (/output\.availableWads: ([^\n]*)/.exec(text) || ['', ''])[1];
    test.skip(!/\bhexen\b/.test(wads), `no hexen.wad in the gateway wads folder (have: ${wads || 'nothing'}); run ops/fetch-hexen-demo.sh before ops/fresh.sh`);
    return root;
}

test('hexen: config.game = hexen runs the Hexen engine from the operator IWAD, with a class', async ({ page }) => {
    const root = await skipWithoutHexen(page);
    await expect(root).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
    await expect(page.getByText(/output\.iwad: hexen\s/)).toBeVisible();
    await expect(page.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 30_000 });
    const hexen = await page.evaluate(() =>
        Array.from(document.scripts).some((s) => s.src.includes('/res/mustry-doom/hexen/websockets-hexen.js')));
    expect(hexen).toBe(true);
});

test('hexen: deathmatch through the same relay, both reach the Winnowing Hall', async ({ browser, page: hostPage }) => {
    await skipWithoutHexen(hostPage);
    const joinCtx = await browser.newContext();
    const joinPage = await joinCtx.newPage();
    try {
        const hostRoot = await openRoute(hostPage, '/arena/host/Baratus/hub/hexen', '.mustry-doom');
        await hostRoot.locator('.mustry-doom__splash').click();
        await expect(hostRoot).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
        await expect(hostPage.getByText(/output\.inLobby: true/)).toBeVisible({ timeout: 30_000 });

        const joinRoot = await openRoute(joinPage, '/arena/join/Parias/hub/hexen', '.mustry-doom');
        await joinRoot.locator('.mustry-doom__splash').click();
        await expect(joinRoot).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });

        await expect(hostPage.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 60_000 });
        await expect(joinPage.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 60_000 });
        await expect(hostPage.getByText(/netPlayers: 2/)).toBeVisible({ timeout: 30_000 });
    } finally {
        await joinCtx.close();
    }
});

// Strife ships its engine but no IWAD, and no free Strife data exists at all:
// the operator's strife1.wad (+ voices.wad) in engine/build/strife/ is seeded
// by fresh.sh; these tests skip without it. Same probe as Hexen.
async function skipWithoutStrife(page: Page) {
    const root = await openRoute(page, '/game/strife', '.mustry-doom');
    await root.locator('.mustry-doom__splash').click();
    const listing = page.getByText(/output\.availableWads: \S/).first();
    await expect(listing).toBeVisible({ timeout: 60_000 });
    const text = (await listing.textContent()) || '';
    const wads = (/output\.availableWads: ([^\n]*)/.exec(text) || ['', ''])[1];
    test.skip(!/\bstrife1\b/.test(wads), `no strife1.wad in the gateway wads folder (have: ${wads || 'nothing'}); copy your own into engine/build/strife/ before ops/fresh.sh`);
    return root;
}

test('strife: config.game = strife runs the Strife engine from the operator IWAD with voices', async ({ page }) => {
    const root = await skipWithoutStrife(page);
    await expect(root).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
    await expect(page.getByText(/output\.iwad: strife1/)).toBeVisible();
    await expect(page.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 30_000 });
    const strife = await page.evaluate(() =>
        Array.from(document.scripts).some((s) => s.src.includes('/res/mustry-doom/strife/websockets-strife.js')));
    expect(strife).toBe(true);
});

test('strife: deathmatch through the same relay, both reach the Sanctuary', async ({ browser, page: hostPage }) => {
    await skipWithoutStrife(hostPage);
    const joinCtx = await browser.newContext();
    const joinPage = await joinCtx.newPage();
    try {
        const hostRoot = await openRoute(hostPage, '/arena/host/Rookie1/sigil/strife', '.mustry-doom');
        await hostRoot.locator('.mustry-doom__splash').click();
        await expect(hostRoot).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });
        await expect(hostPage.getByText(/output\.inLobby: true/)).toBeVisible({ timeout: 30_000 });

        const joinRoot = await openRoute(joinPage, '/arena/join/Rookie2/sigil/strife', '.mustry-doom');
        await joinRoot.locator('.mustry-doom__splash').click();
        await expect(joinRoot).toHaveClass(/mustry-doom--running/, { timeout: 60_000 });

        await expect(hostPage.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 60_000 });
        await expect(joinPage.getByText(/output\.inLevel: true/)).toBeVisible({ timeout: 60_000 });
        await expect(hostPage.getByText(/netPlayers: 2/)).toBeVisible({ timeout: 30_000 });
    } finally {
        await joinCtx.close();
    }
});
