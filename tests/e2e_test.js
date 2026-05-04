const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000');
  
  await page.click('text="+ New project"');
  await page.waitForSelector('text="Create a new project"');
  
  // Set input files
  await page.setInputFiles('input[type="file"]', 'd:/AutoInsight/mnist_test.csv');
  
  console.log("File selected. Waiting for upload...");
  
  // Wait for the continue button to be enabled
  await page.waitForSelector('button:has-text("Continue"):not([disabled])', { timeout: 10000 });
  await page.click('button:has-text("Continue")');
  
  console.log("Continue clicked. Waiting for profile...");
  
  let i = 0;
  try {
    for (i = 0; i < 20; i++) {
        await page.waitForTimeout(1000);
        console.log(`Waiting... ${i+1}s`);
        const preview = await page.$('text="Preview"');
        if (preview) {
             console.log("Profile successful.");
             break;
        }
    }
  } catch(e) {
    console.log("Error waiting for profile: ", e.message);
  }
  
  await page.screenshot({ path: 'd:/AutoInsight/screenshot.png', fullPage: true });
  await browser.close();
})();
