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
  page.on("requestfailed", (r) => {
    /* An in-flight request is aborted when the page navigates away, and the
       overflow sweep navigates 168 times. A lazily-loaded iframe is mid-fetch
       almost every time, so ERR_ABORTED here says "we moved on", not "this is
       broken". Recorded with its reason so the filter can tell them apart
       rather than dropping every failed request. */
    const why = r.failure()?.errorText || "unknown";
    failed.push(`failed ${r.url()} (${why})`);
  });
  page.__failed = failed;
  return failed;
}

/* Noise that is genuinely local, and nothing more.
 *
 * This used to hold a bare /_vercel/insights/ pattern, which silenced the 404
 * that script produces off-Vercel — and, as a side effect, hid the request
 * itself from every assertion that reads this list. The privacy page claimed
 * there was no third-party analytics while that request was being filtered out
 * of the evidence.
 *
 * So the tolerance is now scoped to the 404 specifically. A successful insights
 * request, or any other status, is a real event and site-beacon.js is expected
 * to have an opinion about it. */
const EXPECTED = [
  /^404 \S*\/_vercel\/insights\//,
  /\(net::ERR_ABORTED\)/,
];

/** Console/page errors worth reporting, with the known-local noise removed. */
function realErrors(page) {
  const failed = page.__failed || [];
  const onlyExpected = failed.every((f) => EXPECTED.some((re) => re.test(f)));
  return (page.__errs || []).filter((e) => {
    if (onlyExpected && /Failed to load resource/.test(e)) return false;
    return true;
  });
}

/** Any 4xx/5xx that is not the analytics beacon or a navigation abort. */
function realFailures(page) {
  return (page.__failed || []).filter((f) => !EXPECTED.some((re) => re.test(f)));
}

/**
 * Report errors and failures, and say whether they should fail the check.
 *
 * These used to be printed and nothing more, so a page could 404 its own
 * stylesheet and the check still exited 0 — a check that reports health it is
 * not asserting, which is the same fault as db-rls reading a network refusal
 * as twelve passes. Callers add the returned count to their own.
 */
function reportNoise(page) {
  const errs = realErrors(page);
  const bad = realFailures(page);
  console.log("errs", errs.slice(0, 5), "| bad requests", bad.slice(0, 5));
  if (errs.length || bad.length) {
    console.log(`  FAIL  ${errs.length} console error(s), ${bad.length} failed request(s)`);
  }
  return errs.length + bad.length;
}

module.exports = { trackRequests, realErrors, realFailures, reportNoise };
