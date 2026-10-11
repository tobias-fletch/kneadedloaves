/** Hard guard for synthetic integration suites. Never point these at shop data. */
export function assertIntegrationDatabase() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (process.env.BAKERY_INTEGRATION_TESTS !== '1' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/kneaded_loaves_test') {
    throw new Error('Integration QA requires BAKERY_INTEGRATION_TESTS=1 and a loopback kneaded_loaves_test database.');
  }
}
