"use strict";
/* Where the ops deck lives, in one place.
 *
 * The deck moved from the repo root into public/ when the Astro app arrived —
 * Astro copies public/ into the build verbatim, which is what keeps the deck a
 * byte-identical passthrough with no build step of its own. Seven files named
 * the old path literally and a missed one fails silently (the financials job
 * would splice into a file nobody serves), so they all read it from here now. */
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DECK_FILE = "ops-deck.html";
const DECK = path.join(ROOT, "public", DECK_FILE);
const DECK_ROUTE = "/" + DECK_FILE;

module.exports = { ROOT, DECK, DECK_FILE, DECK_ROUTE };
