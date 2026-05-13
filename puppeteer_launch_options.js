const PUPPETEER_CI_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage"
];

function createPuppeteerLaunchOptions(options = {}) {
  const args = Array.isArray(options.args) ? options.args : [];
  return {
    ...options,
    args: process.env.CI ? [...args, ...PUPPETEER_CI_ARGS] : args
  };
}

module.exports = {
  createPuppeteerLaunchOptions
};
