import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateCmeReport } from "../server/cmeOpenInterest.js";

try {
    if (!process.argv[2]) throw new Error("Usage: node scripts/import-cme-oi.js /path/to/authorized-report.json");
    const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
    validateCmeReport(input);
    const directory = fileURLToPath(new URL("../data/", import.meta.url));
    mkdirSync(directory, { recursive: true });
    const file = `${directory}cme-daily.json`;
    writeFileSync(`${file}.tmp`, `${JSON.stringify(input, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
    console.log(`Imported CME report dated ${input.reportDate}. It will be included on the next cache refresh.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
