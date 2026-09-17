#!/usr/bin/env node

console.error('Indexes-only production deployment is disabled because rollout requires app, rules, and workers together.');
console.error('Use the reviewed, coordinated production release workflow from an isolated release directory.');
process.exit(1);