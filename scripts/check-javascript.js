const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const EXCLUDED_DIRECTORIES = new Set(['.git', '.firebase', 'node_modules']);

function collectJavaScriptFiles(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectJavaScriptFiles(entryPath));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(entryPath);
        }
    }
    return files;
}

const files = collectJavaScriptFiles(ROOT).sort();
let failed = false;

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) failed = true;
}

if (failed) process.exitCode = 1;
else console.log(`JavaScript syntax checks passed (${files.length} files).`);
