#!/usr/bin/env node

const { INSERT_NAME } = require('../dist/');
const pkg = require('../package.json');

function displayUsage() {
  console.log(`Usage: ${pkg.name} [name]`);
}

function displayHeader() {
  const author = `${pkg.author.name} <${pkg.author.email}> ${pkg.author.url}`;
  console.log(`${pkg.name} v${pkg.version}`);
  console.log(`Copyright (c) ${new Date().getFullYear()} ${author}\n`);
}

async function main() {
  displayHeader();
  displayUsage();
  // eslint-disable-next-line new-cap -- INSERT_NAME is a placeholder
  INSERT_NAME();
}

main().catch(console.error);
