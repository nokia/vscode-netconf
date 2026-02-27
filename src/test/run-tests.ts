/*
  @author Sven Wisotzky
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../..');
    const extensionTestsPath = path.resolve(__dirname, 'suite/index');
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions'],
    });
  } catch (err) {
    console.error(err);
    console.error('Failed to run extension tests');
    process.exit(1);
  }
}

main();
