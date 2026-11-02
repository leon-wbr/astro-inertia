import { expect, test } from "@playwright/test";

test("a page renders with real TYPO3 content", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Home · TYPO3 + Inertia");
  await expect(page.locator("body")).toHaveAttribute("data-component", "Default");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Home");
  await expect(page.getByText("Welcome to TYPO3 and Inertia")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "About this example" })).toBeVisible();
  // t3:// links were resolved by TYPO3.
  await expect(page.getByRole("main").getByRole("link", { name: "features" })).toHaveAttribute("href", "/features");
});

test("navigation works between two pages", async ({ page }) => {
  await page.goto("/");
  const main = page.getByRole("navigation", { name: "Main" });
  await main.getByRole("link", { name: "Features" }).click();
  await expect(page).toHaveURL("/features");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Features");
  await expect(page.getByRole("heading", { level: 2, name: "Prop types" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Features" })).toHaveAttribute("aria-current", "page");

  await main.getByRole("link", { name: "Contact" }).click();
  await expect(page).toHaveURL("/contact");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contact");
});

test("navigation works between two languages", async ({ page }) => {
  await page.goto("/features");
  await page.getByRole("navigation", { name: "Language" }).getByRole("link", { name: "DE" }).click();
  await expect(page).toHaveURL("/de/funktionen");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Funktionen");
  await expect(page.getByRole("heading", { level: 2, name: "Prop-Typen" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(["Funktionen", "Kontakt"]);

  await page.getByRole("navigation", { name: "Language" }).getByRole("link", { name: "EN" }).click();
  await expect(page).toHaveURL("/features");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Features");
});

test("German content links stay in German", async ({ page }) => {
  await page.goto("/de/");
  await expect(page.getByText("Willkommen bei TYPO3 und Inertia")).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Funktionen" }).click();
  await expect(page).toHaveURL("/de/funktionen");
});

test("a deferred prop arrives after the first paint", async ({ page, request }) => {
  const html = await (await request.get("/features")).text();
  expect(html).toContain("Loading statistics…");
  await page.goto("/features");
  await expect(page.getByTestId("stats")).toContainText("1 content element(s)");
});

test("a form POST → 303 → error, then success", async ({ page }) => {
  await page.goto("/contact");
  const post = page.waitForResponse((r) => r.request().method() === "POST");
  await page.getByRole("button", { name: "Send" }).click();
  expect((await post).status()).toBe(303);
  await expect(page).toHaveURL("/contact?error=name");
  await expect(page.getByRole("alert")).toHaveText("Please enter your name.");

  await page.getByLabel("Name").fill("Ada");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page).toHaveURL("/contact?sent=Ada");
  await expect(page.getByRole("status")).toHaveText("Thanks, Ada!");
});

test("an unknown path keeps TYPO3's 404", async ({ request }) => {
  const response = await request.get("/this-page-does-not-exist");
  expect(response.status()).toBe(404);
});
