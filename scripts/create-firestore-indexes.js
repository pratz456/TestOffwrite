#!/usr/bin/env node

console.error('Ad hoc index creation is disabled for the production rollout.');
console.error('Review firestore.indexes.json and deploy it only through the coordinated prepared release.');
process.exit(1);
