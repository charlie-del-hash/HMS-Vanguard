/* Shared bits for the site checks. */

/* Vercel Web Analytics injects /_vercel/insights/script.js, which only exists
   on Vercel. Locally it 404s on every page, and the console message it
   produces carries no URL — so filtering the message alone would hide real
   404s too. Record the URLs that actually failed and decide from those. */
function trackRequests(page) {
  const failed = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => failed.push(`failed ${r.url()}`));
  page.__failed = failed;
  return failed;
}

const EXPECTED = [/\/_vercel\/insights\//];

/** Console/page errors worth reporting, with the known-local noise removed. */
function realErrors(page) {
  const failed = page.__failed || [];
  const onlyExpected = failed.every((f) => EXPECTED.some((re) => re.test(f)));
  return (page.__errs || []).filter((e) => {
    if (onlyExpected && /Failed to load resource/.test(e)) return false;
    return true;
  });
}

/** Any 4xx/5xx that is not the analytics beacon. */
function realFailures(page) {
  return (page.__failed || []).filter((f) => !EXPECTED.some((re) => re.test(f)));
}

module.exports = { trackRequests, realErrors, realFailures };
