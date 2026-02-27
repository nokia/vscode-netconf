/*
  @author Sven Wisotzky
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  test('Extension should be present', () => {
    const ext = vscode.extensions.getExtension('nokia.netconf-client');
    assert.ok(ext, 'Extension nokia.netconf-client should be present');
  });

  test('netconf.add command should be registered', async () => {
    const commands = await vscode.commands.getCommands();
    assert.ok(commands.includes('netconf.add'), 'netconf.add command should be registered');
  });

  test('netconf.xml.openNavigator command should be registered', async () => {
    const commands = await vscode.commands.getCommands();
    assert.ok(commands.includes('netconf.xml.openNavigator'), 'netconf.xml.openNavigator should be registered');
  });

  test('netconf.xml.revealInNavigator command should be registered', async () => {
    const commands = await vscode.commands.getCommands();
    assert.ok(commands.includes('netconf.xml.revealInNavigator'), 'netconf.xml.revealInNavigator should be registered');
  });

  test('executeCommand netconf.xml.openNavigator does not throw', async () => {
    await assert.doesNotReject(
      async () => vscode.commands.executeCommand('netconf.xml.openNavigator'),
      'Opening XML Navigator without an XML editor may show a warning but should not throw'
    );
  });
});
