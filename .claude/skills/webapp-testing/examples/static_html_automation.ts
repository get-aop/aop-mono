import { chromium } from "playwright";
import { resolve } from "path";

// Example: Automating interaction with static HTML files using file:// URLs

const htmlFilePath = resolve("path/to/your/file.html"); // Replace with your path
const fileUrl = `file://${htmlFilePath}`;

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Navigate to local HTML file
  await page.goto(fileUrl);

  // Take screenshot
  await page.screenshot({ path: "/tmp/static_page.png", fullPage: true });

  // Interact with elements
  await page.click("text=Click Me");
  await page.fill("#name", "John Doe");
  await page.fill("#email", "john@example.com");

  // Submit form
  await page.click('button[type="submit"]');
  await page.waitForTimeout(500);

  // Take final screenshot
  await page.screenshot({ path: "/tmp/after_submit.png", fullPage: true });

  await browser.close();

  console.log("Static HTML automation completed!");
};

run();
