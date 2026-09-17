import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1320, height: 700 } });
await page.goto('http://localhost:9188/data/perspective/client/verify/arena/join/Player2/demo');
await page.locator('.mustry-doom').first().waitFor();
await page.waitForTimeout(4000);
await page.locator('.mustry-doom__splash').click();
await page.waitForFunction(() => document.querySelector('.mustry-doom--running'), null, { timeout: 60000 });
// stay in the game for a while so the host can be observed
await page.waitForFunction(() => /output\.inLevel: true/.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
console.log('joiner in level:', /output\.inLevel: true/.test(await page.evaluate(() => document.body.innerText)));
await page.waitForTimeout(40000);
await browser.close();
