#!/usr/bin/env node

console.error('Rules-only production deployment is disabled because it can break legacy-client migration.');
console.error('Use the reviewed, coordinated production release workflow from an isolated release directory.');
process.exit(1);
