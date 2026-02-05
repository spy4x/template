import { test, expect } from '@playwright/test';

const APP = process.env.TEST_APP_URL ?? 'http://localhost:3000';

test.describe('GitHub App OAuth flows', () => {
  test('Happy path: connect then disconnect', async ({ page }) => {
    await page.goto(`${APP}/sign-in`);
    // This assumes test user can sign in via a test route. Adjust as needed.
    if (await page.locator('[data-e2e=sign-in-test]').count() > 0) {
      await page.click('[data-e2e=sign-in-test]');
      await page.waitForURL('**/profile');
    } else {
      // fallback: navigate to profile assuming session present
      await page.goto(`${APP}/profile`);
    }

    await expect(page).toHaveURL(/profile/);

    // Click Connect GitHub
    await page.click('[data-e2e=connect-github]');

    // The app should redirect to GitHub (mock). The mock will redirect back to the app and store installation.
    // Wait for return to profile
    await page.waitForURL('**/profile', { timeout: 15000 });

    // Verify connected account UI
    await expect(page.locator('[data-e2e=connected-account]')).toBeVisible();
    await expect(page.locator('[data-e2e=repos-list]')).toBeVisible();

    // Disconnect
    await page.click('[data-e2e=disconnect-github]');
    // Confirm suspended state in UI
    await expect(page.locator('[data-e2e=installed-status]')).toHaveText(/suspended|disconnected/i);
  });
});
