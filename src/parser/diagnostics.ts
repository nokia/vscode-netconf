/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import * as vscode from 'vscode';
import type { XmlParseResult } from './types';

/**
 * Convert parser errors to VS Code diagnostics and publish them for the document.
 */
export function publishParseDiagnostics(
  document: vscode.TextDocument,
  parseResult: XmlParseResult,
  collection: vscode.DiagnosticCollection
): void {
  const uri = document.uri;
  if (parseResult.errors.length === 0) {
    collection.delete(uri);
    return;
  }
  const diagnostics: vscode.Diagnostic[] = parseResult.errors.map((err) => {
    const line = Math.max(0, err.line - 1);
    const range = new vscode.Range(line, Math.max(0, err.column - 1), line, Math.max(0, err.column));
    return new vscode.Diagnostic(range, err.message, vscode.DiagnosticSeverity.Error);
  });
  collection.set(uri, diagnostics);
}

/**
 * Whether the parse result is usable for XML Navigator (valid parse, at least one root node).
 */
export function isParseUsable(parseResult: XmlParseResult): boolean {
  return (
    parseResult.errors.length === 0 &&
    parseResult.rootId >= 0 &&
    parseResult.rowOrder.length > 0
  );
}
