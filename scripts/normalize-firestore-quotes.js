#!/usr/bin/env node
'use strict';

// This script is intentionally opt-in. Running it without --plan or --apply
// does not initialize Firebase or read the database.
const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');
const { normalizeSmartQuotes } = require('../public/js/features/editor/smart-quotes.js');

const COLLECTION = 'lyrics';
const EXPECTED_PROJECT = 'eclyrics-e8d68';
const CONFIRMATION_TOKEN = 'NORMALIZE_LYRICS_QUOTES';
const BATCH_SIZE = 400;
const NORMALIZED_FIELDS = ['title', 'lyrics', 'version'];
const ADAPTATION_FIELDS = ['adapt-of', 'adaptOf'];

function getFlagValue(args, flag) {
    const index = args.indexOf(flag);
    return index === -1 ? '' : String(args[index + 1] || '').trim();
}

function hasFlag(args, flag) {
    return args.includes(flag);
}

function printUsage() {
    console.log(`Firestore quotation-mark migration (collection: ${COLLECTION})

No database operation runs by default.

Plan only (reads the collection, writes nothing):
  GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json \\
  node scripts/normalize-firestore-quotes.js --plan \\
    --project ${EXPECTED_PROJECT}

Apply (reads the collection, then writes only changed quote fields):
  GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json \\
  node scripts/normalize-firestore-quotes.js --apply \\
    --project ${EXPECTED_PROJECT} \\
    --expected-docs COUNT \\
    --max-writes COUNT \\
    --confirm ${CONFIRMATION_TOKEN}

The apply mode updates only title, lyrics, version, and adapt-of/adaptOf.
It never sends last-modified or last-modified-by, so those application fields
are preserved. Each changed document counts as one Firestore write.`);
}

function fail(message) {
    console.error(`Migration refused: ${message}`);
    process.exitCode = 1;
}

function validateArgs(args) {
    const plan = hasFlag(args, '--plan');
    const apply = hasFlag(args, '--apply');
    if (!plan && !apply) return { mode: 'help' };
    if (plan && apply) throw new Error('choose exactly one of --plan or --apply');

    const project = getFlagValue(args, '--project');
    if (project !== EXPECTED_PROJECT) {
        throw new Error(`--project must be exactly ${EXPECTED_PROJECT}`);
    }

    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialsPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS is required');
    if (!path.isAbsolute(credentialsPath)) {
        throw new Error('GOOGLE_APPLICATION_CREDENTIALS must be an absolute path');
    }
    if (!fs.existsSync(credentialsPath)) {
        throw new Error(`credentials file does not exist: ${credentialsPath}`);
    }

    if (apply) {
        const expectedDocs = Number.parseInt(getFlagValue(args, '--expected-docs'), 10);
        const maxWrites = Number.parseInt(getFlagValue(args, '--max-writes'), 10);
        if (!Number.isInteger(expectedDocs) || expectedDocs < 0) {
            throw new Error('--expected-docs is required for --apply');
        }
        if (!Number.isInteger(maxWrites) || maxWrites < 0) {
            throw new Error('--max-writes is required for --apply');
        }
        if (getFlagValue(args, '--confirm') !== CONFIRMATION_TOKEN) {
            throw new Error(`--confirm ${CONFIRMATION_TOKEN} is required for --apply`);
        }
        return { mode: 'apply', credentialsPath, expectedDocs, maxWrites };
    }

    return { mode: 'plan', credentialsPath };
}

function normalizeChangedFields(data) {
    const changes = {};
    for (const field of NORMALIZED_FIELDS) {
        if (typeof data[field] !== 'string') continue;
        const normalized = normalizeSmartQuotes(data[field]);
        if (normalized !== data[field]) changes[field] = normalized;
    }
    for (const field of ADAPTATION_FIELDS) {
        if (typeof data[field] !== 'string') continue;
        const normalized = normalizeSmartQuotes(data[field]);
        if (normalized !== data[field]) changes[field] = normalized;
    }
    return changes;
}

async function run(mode) {
    const serviceAccount = JSON.parse(fs.readFileSync(mode.credentialsPath, 'utf8'));
    if (serviceAccount.project_id !== EXPECTED_PROJECT) {
        throw new Error(`credentials project_id must be ${EXPECTED_PROJECT}`);
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: EXPECTED_PROJECT,
    });

    const snapshot = await admin.firestore().collection(COLLECTION).get();
    if (mode.mode === 'apply' && snapshot.size !== mode.expectedDocs) {
        throw new Error(
            `expected ${mode.expectedDocs} documents, found ${snapshot.size}; no writes were attempted`,
        );
    }

    const changes = snapshot.docs
        .map((doc) => ({ doc, fields: normalizeChangedFields(doc.data()) }))
        .filter((entry) => Object.keys(entry.fields).length > 0);

    console.log(`Read ${snapshot.size} ${COLLECTION} documents.`);
    console.log(`Found ${changes.length} documents requiring normalization.`);
    changes.slice(0, 20).forEach(({ doc, fields }) => {
        console.log(`  ${doc.id}: ${Object.keys(fields).join(', ')}`);
    });
    if (changes.length > 20) console.log(`  ...and ${changes.length - 20} more.`);

    if (mode.mode === 'plan') {
        console.log('Plan complete. No writes were performed.');
        return;
    }

    if (changes.length > mode.maxWrites) {
        throw new Error(
            `found ${changes.length} changes, exceeding --max-writes ${mode.maxWrites}; no writes were attempted`,
        );
    }

    for (let offset = 0; offset < changes.length; offset += BATCH_SIZE) {
        const batch = admin.firestore().batch();
        changes.slice(offset, offset + BATCH_SIZE).forEach(({ doc, fields }) => {
            // Deliberately update only normalized content fields. Audit dates are untouched.
            batch.update(doc.ref, fields);
        });
        await batch.commit();
        console.log(`Wrote ${Math.min(offset + BATCH_SIZE, changes.length)} of ${changes.length}.`);
    }
    console.log('Migration complete. last-modified fields were not changed.');
}

const args = process.argv.slice(2);
try {
    const mode = validateArgs(args);
    if (mode.mode === 'help') {
        printUsage();
    } else {
        void run(mode).catch((error) => fail(error.message || String(error)));
    }
} catch (error) {
    fail(error.message || String(error));
}
