import { expect, test, type Page } from "@playwright/test";

async function pageObject(page: Page) {
  const json = await page.locator('script[type="application/json"][data-page="app"]').textContent();
  return JSON.parse(json ?? "null") as {
    component: string;
    url: string;
    version: string;
    props: Record<string, unknown>;
  };
}

test.describe("first render", () => {
  test("renders the component named by the page object", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Welcome · Mock Inertia");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome");
    await expect(page.locator("body")).toHaveAttribute("data-component", "Home");
    const data = await pageObject(page);
    expect(data).toMatchObject({ component: "Home", url: "/", version: "1" });
    expect(data.props).toMatchObject({ title: "Welcome", errors: {} });
  });

  test("an app's own Astro pages win over the catch-all", async ({ page }) => {
    await page.goto("/hello");
    await expect(page.getByRole("heading")).toHaveText("Plain Astro page");
  });

  test("a 404 page object keeps its status", async ({ page }) => {
    const response = await page.goto("/does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Error 404");
  });

  test("forwards Inertia and proxy headers, cookies included", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "probe", value: "42", url: baseURL! }]);
    await page.goto("/__echo");
    const headers = JSON.parse((await page.locator("#echo").textContent()) ?? "{}") as Record<string, string>;
    expect(headers["x-inertia"]).toBe("true");
    expect(headers["x-inertia-version"]).toBe("1");
    expect(headers["x-requested-with"]).toBe("XMLHttpRequest");
    expect(headers["x-forwarded-host"]).toBe(new URL(baseURL!).host);
    expect(headers["x-forwarded-proto"]).toBe("http");
    expect(headers["cookie"]).toContain("probe=42");
    expect(headers["user-agent"]).toBeTruthy();
  });

  test("copies cache headers and tags, without X-Inertia in Vary", async ({ request }) => {
    const response = await request.get("/about");
    expect(response.headers()["cache-control"]).toBe("public, max-age=60");
    expect(response.headers()["x-cache-tags"]).toBe("pageId_2,pageId_1");
    expect(response.headers()["vary"]).not.toMatch(/x-inertia/i);
    expect(response.headers()["vary"]).toMatch(/Accept-Language/);
  });

  test("a React island gets page props", async ({ page }) => {
    await page.goto("/users");
    const list = page.getByTestId("users");
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await page.getByLabel("Filter users").fill("grace");
    await expect(list.getByRole("listitem")).toHaveText(["Grace Hopper"]);
  });
});

test.describe("navigation", () => {
  test("links navigate with the ClientRouter, without a full reload", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
    await page.getByRole("navigation").getByRole("link", { name: "About", exact: true }).click();
    await expect(page).toHaveURL("/about");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About us");
    expect((await pageObject(page)).component).toBe("About");
    expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);

    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome");
  });

  test("plain links do a full page load", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
    await page.getByTestId("plain-link").click();
    await expect(page).toHaveURL("/about");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About us");
    expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBeUndefined();
  });

  test("works without JavaScript", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: baseURL! });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "Users" }).click();
    await expect(page).toHaveURL("/users");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Users");
    await context.close();
  });
});

test.describe("forms", () => {
  test("POST → 303 → validation errors from the session", async ({ page }) => {
    await page.goto("/contact");
    await page.getByLabel("Email").fill("not-an-email");
    const post = page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/contact",
    );
    await page.getByRole("button", { name: "Send" }).click();
    expect((await post).status()).toBe(303);
    await expect(page).toHaveURL("/contact");
    await expect(page.locator('[data-error="name"]')).toHaveText("The name field is required.");
    await expect(page.locator('[data-error="email"]')).toHaveText("The email must be a valid email address.");
    await expect(page.getByLabel("Email")).toHaveValue("not-an-email");
    expect((await pageObject(page)).props.errors).toMatchObject({ name: "The name field is required." });

    await page.reload();
    await expect(page.locator("[data-error]")).toHaveCount(0);
  });

  test("a valid POST redirects and flashes a message", async ({ page }) => {
    await page.goto("/contact");
    await page.getByLabel("Name").fill("Ada");
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("status")).toHaveText("Thanks, Ada!");
    await expect(page.getByTestId("messages")).toContainText("Ada <ada@example.com>");
  });

  test("plain HTML forms work without JavaScript", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: baseURL! });
    const page = await context.newPage();
    await page.goto("/contact");
    const post = page.waitForResponse((r) => r.request().method() === "POST");
    await page.getByRole("button", { name: "Send" }).click();
    const response = await post;
    expect(response.status()).toBe(303);
    expect(response.headers()["location"]).toBe("/contact");
    await expect(page.locator('[data-error="name"]')).toBeVisible();
    await context.close();
  });
});

test.describe("deferred props", () => {
  test("the first response has the fallback; the island fills it in", async ({ page, request }) => {
    const html = await (await request.get("/users?delay=600")).text();
    expect(html).toContain("Loading statistics…");
    expect(html).not.toContain("users active");

    const started = Date.now();
    await page.goto("/users?delay=600");
    // The page itself did not wait for the deferred prop.
    expect(Date.now() - started).toBeLessThan(600);
    await expect(page.getByTestId("stats-loading")).toBeVisible();
    await expect(page.getByTestId("stats")).toHaveText("2 of 3 users active");
    await expect(page.getByTestId("activity")).toHaveText("Ada signed in");
  });
});

test.describe("protocol edge cases", () => {
  test("a version mismatch reloads without the version and flags it", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "mock_version", value: "2", url: baseURL! }]);
    const response = await page.goto("/about");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-astro-inertia-version-mismatch"]).toBe("2");
    await expect(page.locator("body")).toHaveAttribute("data-version", "2");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About us");
  });

  test("no mismatch header when versions agree", async ({ request }) => {
    const response = await request.get("/about");
    expect(response.headers()["x-astro-inertia-version-mismatch"]).toBeUndefined();
  });

  test("passes a non-Inertia HTML response through", async ({ page }) => {
    const response = await page.goto("/legacy");
    expect(response?.status()).toBe(200);
    await expect(page.locator("#legacy")).toHaveText("A plain HTML page");
    await expect(page.locator("script[data-page]")).toHaveCount(0);
  });

  test("a missing component is a clear 500", async ({ page }) => {
    const response = await page.goto("/missing");
    expect(response?.status()).toBe(500);
    await expect(page.getByRole("heading")).toHaveText("Inertia component not found");
    await expect(page.locator("pre")).toContainText('no component "Missing/Page"');
    await expect(page.locator("pre")).toContainText("src/pages-inertia/Missing/Page.astro");
  });

  test("409 + X-Inertia-Location becomes a 303 to the external URL", async ({ request }) => {
    const response = await request.get("/external", { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()["location"]).toBe("https://example.com/elsewhere");
  });

  test("409 + X-Inertia-Redirect keeps the fragment", async ({ page }) => {
    await page.goto("/fragment");
    await expect(page).toHaveURL("/about#team");
  });

  test("a redirect to the backend's own origin stays on the public host", async ({ request }) => {
    const response = await request.get("/old-about", { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    expect(response.headers()["location"]).toBe("/about");
  });

  test("session cookies from the backend reach the browser", async ({ page, context }) => {
    await page.goto("/");
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "mock_session")?.httpOnly).toBe(true);
  });
});
