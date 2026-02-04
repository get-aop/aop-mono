import { chromium } from "playwright";

// Example: Discovering buttons and other elements on a page

const url = "http://localhost:5173"; // Replace with your URL

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Navigate to page and wait for it to fully load
  await page.goto(url);
  await page.waitForLoadState("networkidle");

  // Discover all buttons on the page
  const buttons = await page.locator("button").all();
  console.log(`Found ${buttons.length} buttons:`);
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i];
    const isVisible = await button.isVisible();
    const text = isVisible ? await button.innerText() : "[hidden]";
    console.log(`  [${i}] ${text}`);
  }

  // Discover links
  const links = await page.locator("a[href]").all();
  console.log(`\nFound ${links.length} links:`);
  for (const link of links.slice(0, 5)) {
    const text = (await link.innerText()).trim();
    const href = await link.getAttribute("href");
    console.log(`  - ${text || "[no text]"} -> ${href}`);
  }

  // Discover input fields
  const inputs = await page.locator("input, textarea, select").all();
  console.log(`\nFound ${inputs.length} input fields:`);
  for (const inputElem of inputs) {
    const name =
      (await inputElem.getAttribute("name")) ||
      (await inputElem.getAttribute("id")) ||
      "[unnamed]";
    const inputType = (await inputElem.getAttribute("type")) || "text";
    console.log(`  - ${name} (${inputType})`);
  }

  // Take screenshot for visual reference
  await page.screenshot({ path: "/tmp/page_discovery.png", fullPage: true });
  console.log("\nScreenshot saved to /tmp/page_discovery.png");

  await browser.close();
};

run();
