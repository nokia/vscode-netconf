/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

declare module 'sax' {
  export interface Tag {
    name: string;
    attributes: Record<string, string>;
  }
  export interface QualifiedTag extends Tag {
    uri: string;
    local: string;
    prefix: string;
  }
  export interface SAXParser {
    onopentag?: (tag: QualifiedTag | Tag) => void;
    onclosetag?: (name: string) => void;
    ontext?: (text: string) => void;
    onerror?: (err: Error) => void;
    write: (chunk: string | null) => SAXParser;
    close: () => SAXParser;
    line: number;
    column: number;
  }
  export function parser(strict: boolean, options?: { trim?: boolean; position?: boolean }): SAXParser;
}
