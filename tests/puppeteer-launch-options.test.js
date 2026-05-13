const test = require("node:test");
const assert = require("node:assert/strict");

const { createPuppeteerLaunchOptions } = require("../puppeteer_launch_options");

function withCi(value, fn) {
  const original = process.env.CI;
  if (value === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = value;
  }

  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = original;
    }
  }
}

test("Puppeteer launch options leave local launches sandboxed", () => {
  withCi(undefined, () => {
    const options = createPuppeteerLaunchOptions({
      headless: true,
      args: ["--lang=es"]
    });

    assert.deepEqual(options, {
      headless: true,
      args: ["--lang=es"]
    });
  });
});

test("Puppeteer launch options disable Chromium sandbox in CI", () => {
  withCi("true", () => {
    const options = createPuppeteerLaunchOptions({
      headless: true,
      args: ["--lang=es"]
    });

    assert.equal(options.headless, true);
    assert.deepEqual(options.args.slice(0, 1), ["--lang=es"]);
    assert.ok(options.args.includes("--no-sandbox"));
    assert.ok(options.args.includes("--disable-setuid-sandbox"));
    assert.ok(options.args.includes("--disable-dev-shm-usage"));
  });
});
