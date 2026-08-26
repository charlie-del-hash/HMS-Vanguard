#!/usr/bin/env node
/* Serves the deck and runs every check against it. No arguments runs all of
   them; name one or more to run a subset:

     node checks/run.js
     node checks/run.js charts routing

   The contrast check is differential and is skipped here unless a baseline is
   given — see the header of contrast.js. */
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "affinity-ops-deck.html");
const ORDER = ["overflow", "charts", "index-labels", "index-anchors",
               "routing", "crosshair", "sourced", "splice", "ciks", "interact", "rest"];

const wanted = process.argv.slice(2).filter(a => !a.startsWith("-"));
const checks = wanted.length ? wanted : ORDER;

const html = fs.readFileSync(FILE);
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
});

server.listen(0, "127.0.0.1", async () => {
  const url = `http://127.0.0.1:${server.address().port}/affinity-ops-deck.html`;
  let failed = 0;
  for(const name of checks){
    const file = path.join(__dirname, `${name}.js`);
    if(!fs.existsSync(file)){ console.log(`\n— ${name}: no such check`); failed++; continue; }
    console.log(`\n— ${name}`);
    /* spawn, not spawnSync: the server lives in this process, and a
       synchronous child would block the event loop that has to serve it */
    const code = await new Promise(res => {
      const c = spawn(process.execPath, [file], { stdio: "inherit", env: { ...process.env, DECK_URL: url } });
      c.on("close", res);
    });
    if(code !== 0) failed++;
  }
  server.close();
  console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
});
