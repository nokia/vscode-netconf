/*
  @author Sven Wisotzky
  
  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause

  Path segment parsing and building for path bar and context menus.
  Re-exports from common for webview bundle (format-agnostic).
*/

export {
  splitPathSegments,
  parsePathSegment,
  buildPathSegment,
  formatPathPredicateValue,
} from '../common/path-utils';
