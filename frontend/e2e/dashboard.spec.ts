import { expect, test, type Page } from "@playwright/test";

const email = "a@example.com";
const password = "1234";

// redirect destination
const destination = "http://localhost:8080/favicon.svg";

let code = "";

let page: Page;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

function row() {
  return page.locator("tbody tr").filter({ has: page.getByRole("link", { name: code }) });
}

test("register", async () => {
  await page.goto("/register");

  await page.getByLabel(/Email address/).fill(email);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/login$/);
});

test("login", async () => {
  await page.goto("/login");

  await page.getByLabel(/Email address/).fill(email);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("button", { name: "Add redirect" })).toBeVisible();
});

test("create link", async () => {
  await page.getByRole("button", { name: "Add redirect" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.getByLabel("Destination URL").fill(destination);
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("dialog")).toBeHidden();

  const anchor = page.locator("tbody tr a").first();
  await expect(anchor).toBeVisible();

  code = (await anchor.innerText()).trim();
  expect(code).toMatch(/^[A-Za-z0-9]{7}$/);

  await expect(row().locator("td").nth(0)).toHaveText(destination);
  await expect(row().locator("td").nth(3)).toHaveText("Active");
});

test("disable link", async () => {
  await row().getByRole("button", { name: "Disable" }).click();

  await expect(row().locator("td").nth(3)).toHaveText("Disabled");

  // A disabled code must stop redirecting
  const response = await page.request.get(`/x/${code}`, { maxRedirects: 0 });
  expect(response.status()).toBe(404);
});

test("enable link", async () => {
  await row().getByRole("button", { name: "Enable" }).click();

  await expect(row().locator("td").nth(3)).toHaveText("Active");
});

test("click link", async () => {
  await expect(row().locator("td").nth(2)).toHaveText("0");

  await row().getByRole("link", { name: code }).click();
  await expect(page).toHaveURL(/favicon\.svg$/);

  await page.goto("/");
  await expect(row().locator("td").nth(2)).toHaveText("1");
});

test("delete link", async () => {
  await row().getByRole("button", { name: "Delete" }).click();

  await expect(row()).toHaveCount(0);
  await expect(page.locator("tbody tr")).toHaveCount(0);
});

test("retry link after delete", async () => {
  const response = await page.goto(`/x/${code}`);

  expect(response?.status()).toBe(404);
});
