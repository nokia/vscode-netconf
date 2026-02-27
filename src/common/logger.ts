/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

export interface Logger {
  clone(): Logger;
  setContext(context: string | undefined): void;
  trace(message: string, ...attributes: unknown[]): void;
  debug(message: string, ...attributes: unknown[]): void;
  info(message: string, ...attributes: unknown[]): void;
  warn(message: string, ...attributes: unknown[]): void;
  error(message: string, ...attributes: unknown[]): void;
}
