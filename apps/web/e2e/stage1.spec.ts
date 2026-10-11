import { test, expect, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import { randomUUID } from "node:crypto";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Configure ${name} para executar a validação de navegador.`);
  return value;
}

async function login(page: Page, email = required("E2E_EMAIL"), mfaCode?: string) {
  await page.goto("/login");
  await page.getByLabel("Organização", { exact: true }).fill(required("E2E_TENANT_SLUG"));
  await page.getByLabel("Empresa", { exact: true }).fill(required("E2E_COMPANY_SLUG"));
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(required("E2E_PASSWORD"));
  if (mfaCode) await page.getByLabel(/Código de verificação/).fill(mfaCode);
  await page.getByRole("button", { name: "Entrar no workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: /^Olá,/ })).toBeVisible();
}

test("redireciona visita sem sessão e valida campos do login", async ({ page }) => {
  await page.goto("/colaboradores");
  await expect(page).toHaveURL(/\/login\?/);
  await page.getByRole("button", { name: "Entrar no workspace" }).click();
  await expect(page.getByText("Informe sua organização.")).toBeVisible();
  await expect(page.getByText("Informe um e-mail válido.")).toBeVisible();
});

test("login consulta dashboard real e logout encerra acesso", async ({ page, context }) => {
  const response = page.waitForResponse(res => res.url().endsWith("/api/v1/dashboard") && res.ok());
  await login(page);
  const dashboard = await (await response).json();
  expect(dashboard.totalEmployees).toBeGreaterThanOrEqual(0);
  expect(dashboard.activeEmployees + dashboard.onLeaveEmployees + dashboard.terminatedEmployees).toBe(dashboard.totalEmployees);
  await expect(page.getByRole("heading", { name: "Admissões mais recentes" })).toBeVisible();
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/dashboard.png`, fullPage: true });
  await page.getByRole("button", { name: "Sair da conta" }).click();
  await expect(page).toHaveURL(/\/login$/);
  const cookies = await context.cookies();
  expect(cookies.some(cookie => cookie.name === "access_token" || cookie.name === "refresh_token")).toBe(false);
  await page.goto("/colaboradores");
  await expect(page).toHaveURL(/\/login\?/);
});

test("persiste cadastro, edição, busca e filtro de colaboradores", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Colaboradores", exact: true }).click();
  const registration = `e2e-${randomUUID().slice(0, 12)}`;
  const fullName = `Colaborador ${registration}`;
  await page.getByRole("button", { name: "Novo colaborador" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome completo").fill(fullName);
  await dialog.getByLabel("Matrícula").fill(registration);
  await dialog.getByLabel("E-mail (opcional)").fill(`${registration}@example.invalid`);
  await dialog.getByLabel("Cargo", { exact: true }).fill("Analista de Pessoas");
  await dialog.getByLabel("Departamento", { exact: true }).fill("Pessoas e Cultura");
  await dialog.getByLabel("Data de admissão").fill("2026-01-15");
  await dialog.getByRole("button", { name: "Cadastrar colaborador" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Colaborador cadastrado com sucesso." })).toBeVisible();
  await page.getByLabel("Buscar colaboradores por nome ou matrícula").fill(registration);
  await expect(page.getByText(fullName, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Editar ${fullName}`, exact: true }).click();
  await dialog.getByLabel("Nome completo").fill(`${fullName} Atualizado`);
  await dialog.getByLabel("E-mail (opcional)").fill("");
  await dialog.getByLabel("Situação", { exact: true }).selectOption("ON_LEAVE");
  await dialog.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cadastro atualizado com sucesso." })).toBeVisible();
  await page.getByLabel("Filtrar por situação").selectOption("ON_LEAVE");
  await expect(page.getByText(`${fullName} Atualizado`, { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel("Buscar colaboradores por nome ou matrícula").fill(registration);
  await expect(page.getByText(`${fullName} Atualizado`, { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Afastado", exact: true })).toBeVisible();
  const pagination = page.waitForResponse(res => res.url().includes("/employees?") && res.url().includes(`q=${registration}`) && res.url().includes("pageSize=25") && res.ok());
  await page.getByLabel("Por página", { exact: true }).selectOption("25");
  const data = await (await pagination).json();
  expect(data.pageSize).toBe(25);
  expect(data.total).toBe(1);
});

test("menu móvel tem navegação acessível e tema persiste", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "Abrir navegação" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "Colaboradores", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Colaboradores", exact: true })).toBeVisible();
  await expect(drawer).not.toBeVisible();
  const toggle = page.getByRole("button", { name: /Ativar modo (claro|escuro)/ });
  if (await toggle.getAttribute("aria-label") === "Ativar modo claro") await toggle.click();
  await page.getByRole("button", { name: "Ativar modo escuro" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/mobile-dark.png`, fullPage: true });
});

test("renova acesso entre duas abas sem reutilizar refresh token", async ({ page, context }) => {
  await login(page);
  const second = await context.newPage();
  await second.goto("/colaboradores");
  await expect(second.getByRole("heading", { name: "Colaboradores", exact: true })).toBeVisible();
  await context.clearCookies({ name: "access_token" });
  await Promise.all([page.goto("/colaboradores"), second.reload()]);
  await expect(page.getByRole("heading", { name: "Colaboradores", exact: true })).toBeVisible();
  await expect(second.getByRole("heading", { name: "Colaboradores", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Colaboradores", exact: true })).toBeVisible();
});

test("renova proteção CSRF expirada antes da mutação", async ({ page, context }) => {
  await login(page);
  await context.clearCookies({ name: "csrf_token" });
  await page.getByRole("button", { name: "Sair da conta" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("renova a sessão após expiração simultânea de acesso e CSRF", async ({ page, context }) => {
  await login(page);
  await context.clearCookies({ name: "access_token" });
  await context.clearCookies({ name: "csrf_token" });
  await page.getByRole("link", { name: "Colaboradores", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Colaboradores", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/colaboradores$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Colaboradores", exact: true })).toBeVisible();
});

test("proxy impõe limite de corpo e página entrega CSP com nonce", async ({ request, page }) => {
  const response = await page.goto("/login");
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toMatch(/script-src[^;]*'nonce-[^']+'/);
  expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  const oversized = await request.post("/api/v1/auth/login", { data: "x".repeat(65537), headers: { "content-type": "application/json" } });
  expect(oversized.status()).toBe(413);
});

test("ativa MFA, exibe códigos uma vez e aceita recuperação de 39 caracteres", async ({ page }) => {
  const email = process.env.E2E_MFA_EMAIL;
  test.skip(!email, "Configure uma conta exclusiva inicialmente sem MFA em E2E_MFA_EMAIL.");
  await login(page, email!);
  await page.getByRole("link", { name: "Segurança", exact: true }).click();
  await page.getByLabel("Senha atual", { exact: true }).last().fill(required("E2E_PASSWORD"));
  await page.getByRole("button", { name: "Configurar dois fatores" }).click();
  await page.getByText("Digitar a chave manualmente", { exact: true }).click();
  const secret = await page.locator("details code").textContent();
  expect(secret).toBeTruthy();
  await page.getByLabel("2. Confirme o código de seis dígitos").fill(authenticator.generate(secret!));
  await page.getByRole("button", { name: "Ativar dois fatores", exact: true }).click();
  await expect(page).toHaveURL(/\/recuperacao$/);
  const codes = (await page.getByLabel("Seus códigos de recuperação").inputValue()).split("\n");
  expect(codes).toHaveLength(10);
  expect(codes[0]).toMatch(/^(?:[a-f0-9]{4}-){7}[a-f0-9]{4}$/i);
  await expect(page.getByRole("button", { name: "Continuar para o login" })).toBeDisabled();
  await page.getByLabel("Guardei meus códigos em um local seguro.").check();
  await page.getByRole("button", { name: "Continuar para o login" }).click();
  await login(page, email!, codes[0]);
  await page.getByRole("link", { name: "Segurança", exact: true }).click();
  await expect(page.getByText("Ativado", { exact: true })).toBeVisible();
  await page.getByLabel("Senha atual", { exact: true }).last().fill(required("E2E_PASSWORD"));
  await page.getByLabel("Código do autenticador ou de recuperação").fill(codes[1]);
  await page.getByRole("button", { name: "Desativar dois fatores" }).click();
  await expect(page).toHaveURL(/\/login\?updated=mfa-disabled$/);
});
