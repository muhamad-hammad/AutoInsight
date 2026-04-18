import { test, expect } from "@playwright/test";
import path from "path";

const FIXTURE_CSV = path.join(__dirname, "fixtures", "fixture.csv");

test.describe("AutoInsight workspace", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto("/workspace");
  });

  test("upload → profile → roadmap flow", async ({ page }) => {
    // 1. Upload fixture CSV via the hidden file input
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_CSV);

    // 2. Progress bar appears
    const progressBar = page.getByTestId("progress-bar");
    await expect(progressBar).toBeVisible({ timeout: 10_000 });

    // 3. Wait for profiling to complete — bar shows "100%"
    await expect(progressBar.getByText("100%")).toBeVisible({ timeout: 90_000 });

    // 4. ProfileCharts is rendered; click a feature badge to select target column.
    //    The null-rates section contains one badge per feature name.
    const featureBadge = page
      .locator("text=Null rates")
      .locator("..")
      .locator(".cursor-pointer")
      .first();
    await expect(featureBadge).toBeVisible({ timeout: 10_000 });
    await featureBadge.click();

    // 5. RoadmapCard renders (loading state first, then content)
    const roadmapCard = page.getByTestId("roadmap-card");
    await expect(roadmapCard).toBeVisible({ timeout: 10_000 });

    // Wait until the loading message is gone (recommendations loaded)
    await expect(
      roadmapCard.getByText("Generating model recommendations…")
    ).toBeHidden({ timeout: 30_000 });

    // 6. Expand first roadmap to reveal the keras snippet copy button
    await roadmapCard.locator("button").first().click();

    // 7. keras-snippet copy button is visible — confirms keras_snippet is non-empty
    await expect(page.getByTestId("keras-snippet")).toBeVisible({ timeout: 5_000 });

    // 8. DataGrid shows at least 5 data rows
    const dataGrid = page.getByTestId("data-grid");
    await expect(dataGrid).toBeVisible({ timeout: 10_000 });
    const rowCount = await dataGrid.locator("tbody tr").count();
    expect(rowCount).toBeGreaterThanOrEqual(5);

    // 9. No JS console errors during the entire flow
    expect(consoleErrors, `Console errors: ${consoleErrors.join("\n")}`).toHaveLength(0);
  });
});
