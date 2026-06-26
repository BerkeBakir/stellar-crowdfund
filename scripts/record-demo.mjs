import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('public/demo', { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: 'public/demo', size: { width: 1280, height: 800 } } });
const page = await ctx.newPage();
async function cap(t){ await page.evaluate((x)=>{let e=document.getElementById('__cap');if(!e){e=document.createElement('div');e.id='__cap';e.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#000d;color:#fff;padding:10px 20px;border-radius:10px;font:18px system-ui;z-index:99999;box-shadow:0 4px 16px #0008';document.body.appendChild(e);}e.textContent=x;},t); }
await page.goto('http://localhost:3000',{waitUntil:'networkidle'});
await page.waitForTimeout(11000);
await cap('Stellar Crowdfund — factory-deployed campaigns, real XLM on Testnet'); await page.waitForTimeout(3500);
await cap('Live campaigns: progress bars, % funded, countdown — updated from on-chain events'); await page.waitForTimeout(4000);
const funded = page.locator('a[href^="/campaign/"]').nth(2);
if(await funded.count()){ const h=await funded.getAttribute('href'); await page.goto('http://localhost:3000'+h,{waitUntil:'networkidle'}); await page.waitForTimeout(6000); await cap('Campaign detail: contribute / claim / refund + creator reputation (3 contracts)'); await page.waitForTimeout(4500); }
await page.goto('http://localhost:3000/create',{waitUntil:'networkidle'}); await page.waitForTimeout(2500);
await cap('Create a campaign — the Factory deploys a fresh Campaign contract on-chain'); await page.waitForTimeout(4500);
await page.goto('http://localhost:3000',{waitUntil:'networkidle'}); await page.waitForTimeout(2500);
const c=page.getByRole('button',{name:/connect wallet/i}); if(await c.count()){ await c.click(); await page.waitForTimeout(3500); await cap('Connect any Stellar wallet (StellarWalletsKit)'); await page.waitForTimeout(2500); }
await cap('3 contracts • inter-contract calls • real XLM • live events • CI/CD'); await page.waitForTimeout(3500);
await ctx.close(); await browser.close();
console.log('recorded');
