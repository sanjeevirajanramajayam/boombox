
import { readFileSync } from 'node:fs';

const input = readFileSync(0, 'utf8');
const lines = input.split('\n');
const output = [];

let inTaggedBlock = false;

for (const line of lines) {
  // Check for the start of a first-principles tag: // [WHY], // [HOW], // [INVARIANTS
  if (/^\s*\/\/\s*\[(WHY|HOW|INVARIANTS)/i.test(line)) {
    inTaggedBlock = true;
    continue;
  }

  // Check for continuation line of the tagged block (indented comment line after the tag)
  if (inTaggedBlock && /^\s*\/\/\s{2,}/.test(line)) {
    continue;
  }

  // Not in tagged block or block ended
  inTaggedBlock = false;
  output.push(line);
}

process.stdout.write(output.join('\n'));
