// npm run hash-password: asks for a password and prints the hash to put in
// UCCB_PASSWORD_HASH (docs/HOSTING.md), so the password itself isn't kept
// in the server's settings.

import { createInterface } from 'node:readline';
import { hashPassword } from './auth.mjs';

const ask = (question) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Don't show what's typed.
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });

const first = await ask('Password: ');
if (first.length < 8) {
  console.error('Use at least 8 characters.');
  process.exit(1);
}
if ((await ask('Again: ')) !== first) {
  console.error("They don't match.");
  process.exit(1);
}
console.log(`\nUCCB_PASSWORD_HASH=${await hashPassword(first)}`);
