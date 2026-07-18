// One-time crawl of WHO's public ICD-10 (2019) browser tree into a local
// CSV — the same bare WHO ICD-10 codes (e.g. C50.9) NHCX's implementation
// guide references, straight from the authority that publishes them.
// Not the NIH ICD-10-CM API (removed earlier — wrong country's coding
// system). No API key needed: this is the public JSON the browser itself
// uses (icd.who.int/browse10), confirmed via live network inspection.
//
// Usage: node scripts/fetch_who_icd10.mjs
// Output: data/icd10_who_full.csv (code,display)

import { writeFile } from "fs/promises";
import path from "path";

const BASE = "https://icd.who.int/browse10/2019/en";
const OUT = path.resolve(process.cwd(), "data", "icd10_who_full.csv");
const CONCURRENCY = 6;

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

async function getChildren(conceptId) {
  const url = `${BASE}/JsonGetChildrenConcepts?ConceptId=${encodeURIComponent(conceptId)}&useHtml=false&showAdoptedChildren=false`;
  return getJson(url);
}

const leaves = [];
let nodesVisited = 0;

// Simple concurrency-limited worker queue over a growing frontier.
async function crawl(rootIds) {
  const queue = [...rootIds];
  let active = 0;
  let resolveAll;
  const done = new Promise((r) => (resolveAll = r));

  function checkDone() {
    if (queue.length === 0 && active === 0) resolveAll();
  }

  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift();
      active++;
      try {
        const children = await getChildren(id);
        nodesVisited++;
        if (nodesVisited % 100 === 0) {
          process.stdout.write(`\rvisited ${nodesVisited} nodes, ${leaves.length} leaf codes so far...`);
        }
        for (const c of children) {
          if (c.isLeaf) {
            // label is like "C50.9 Malignant neoplasm: Breast, unspecified"
            const display = c.label.replace(new RegExp(`^${escapeRe(c.ID)}\\s*`), "").trim();
            leaves.push({ code: c.ID, display: display || c.label });
          } else {
            queue.push(c.ID);
          }
        }
      } catch (e) {
        console.error(`\nfailed ${id}: ${e.message}`);
      } finally {
        active--;
      }
    }
    checkDone();
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await done;
  await Promise.all(workers);
}

async function main() {
  console.log("Fetching WHO ICD-10 2019 chapter roots...");
  const roots = await getJson(`${BASE}/JsonGetRootConcepts?useHtml=false`);
  console.log(`${roots.length} chapters found. Crawling full tree (this walks every block/category — may take several minutes)...`);
  await crawl(roots.map((r) => r.ID));
  console.log(`\nDone. ${leaves.length} leaf codes collected from ${nodesVisited} nodes.`);

  const rows = ["code,display"];
  for (const { code, display } of leaves) {
    const safeDisplay = `"${display.replace(/"/g, '""')}"`;
    rows.push(`${code},${safeDisplay}`);
  }
  await writeFile(OUT, rows.join("\n"), "utf8");
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
