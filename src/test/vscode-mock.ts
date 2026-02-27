/*
  Minimal vscode mock for unit tests so parser/diagnostics (and any module importing vscode) loads in Node.
*/
const Range = class {};
const Diagnostic = class {};
const DiagnosticSeverity = { Error: 0 };
const TextDocument = class {};
const DiagnosticCollection = class {};
export default {
  Range,
  Diagnostic,
  DiagnosticSeverity,
  TextDocument,
  DiagnosticCollection,
};
