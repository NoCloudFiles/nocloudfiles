import {defineConfig,devices} from '@playwright/test';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
const localBrowser=`${homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync(localBrowser)?localBrowser:undefined);
export default defineConfig({testDir:'./tests/browser',timeout:45000,expect:{timeout:8000},fullyParallel:false,workers:1,retries:0,reporter:'list',use:{baseURL:process.env.TEST_URL||'http://127.0.0.1:4178',trace:'retain-on-failure',screenshot:'only-on-failure'},projects:[{name:'chromium',use:{...devices['Desktop Chrome'],launchOptions:{executablePath}}},{name:'webkit-mobile',use:{...devices['iPhone 13']}}],webServer:process.env.TEST_URL?undefined:{command:'node tests/serve.mjs',url:'http://127.0.0.1:4178',reuseExistingServer:false}});
