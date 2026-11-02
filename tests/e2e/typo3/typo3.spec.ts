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
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText([
    "Funktionen",
    "Artikel",
    "Kontakt",
  ]);

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

test("a form POST → 303 → errors after the redirect, then a flash message once", async ({ page }) => {
  await page.goto("/contact");
  const post = page.waitForResponse((r) => r.request().method() === "POST");
  await page.getByRole("button", { name: "Send" }).click();
  expect((await post).status()).toBe(303);
  await expect(page).toHaveURL("/contact");
  await expect(page.getByRole("alert")).toHaveText("Please enter your name.");
  await expect(page.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");

  // The errors came through the session once: a reload doesn't bring them back.
  await page.reload();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByLabel("Name").fill("Ada");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page).toHaveURL("/contact");
  await expect(page.getByRole("status")).toHaveText("Thanks, Ada!");
  await expect(page.getByRole("alert")).toHaveCount(0);

  // Flash data is shown once: the next visit has the form again.
  await page.reload();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByLabel("Name")).toBeVisible();
});

test("a once prop is on every page astro-inertia renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("labels")).toHaveText("An example of TYPO3 and Inertia.");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Features" }).click();
  await expect(page).toHaveURL("/features");
  await expect(page.getByTestId("labels")).toHaveText("An example of TYPO3 and Inertia.");
  await page.goto("/de/");
  await expect(page.getByTestId("labels")).toHaveText("Ein Beispiel für TYPO3 und Inertia.");
});

test("a scroll prop renders one page of articles with links to the next", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Articles" }).click();
  await expect(page).toHaveURL("/articles");
  await expect(page.locator("body")).toHaveAttribute("data-component", "Articles");
  const articles = page.getByTestId("articles").getByRole("listitem");
  await expect(articles).toHaveCount(10);
  await expect(articles.first()).toHaveText("Article 1");

  const pager = page.getByRole("navigation", { name: "Articles" });
  await expect(pager.getByRole("link", { name: "Previous articles" })).toHaveCount(0);
  await pager.getByRole("link", { name: "More articles" }).click();
  await expect(page).toHaveURL("/articles?page=2");
  await expect(articles.first()).toHaveText("Article 11");
  await expect(pager.getByRole("link", { name: "Previous articles" })).toHaveAttribute("href", "/articles?page=1");

  await page.goto("/articles?page=4");
  await expect(articles).toHaveText(["Article 31", "Article 32", "Article 33", "Article 34", "Article 35"]);
  await expect(pager.getByRole("link", { name: "More articles" })).toHaveCount(0);
});

test("an unknown path keeps TYPO3's 404", async ({ request }) => {
  const response = await request.get("/this-page-does-not-exist");
  expect(response.status()).toBe(404);
});
