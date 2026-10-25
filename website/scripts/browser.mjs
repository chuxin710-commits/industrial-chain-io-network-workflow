import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

export async function launchBrowser() {
  const executablePath =
    process.env.BROWSER_PATH ||
    [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ].find(existsSync);
  return chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--enable-unsafe-swiftshader',
      '--disable-background-timer-throttling',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
}
