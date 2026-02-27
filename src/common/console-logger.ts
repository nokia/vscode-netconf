/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import type { Logger } from './logger';

export class ConsoleLogger implements Logger {
  private context: string | undefined;

  constructor() {
    this.context = undefined;
  }

  clone(): ConsoleLogger {
    return new ConsoleLogger();
  }

  setContext(context: string | undefined): void {
    this.context = context;
  }

  trace(message: string, ...attributes: unknown[]): void {
    if (this.context) console.trace(this.context, message, ...attributes);
    else console.trace(message, ...attributes);
  }

  debug(message: string, ...attributes: unknown[]): void {
    if (this.context) console.debug(this.context, message, ...attributes);
    else console.debug(message, ...attributes);
  }

  info(message: string, ...attributes: unknown[]): void {
    if (this.context) console.info(this.context, message, ...attributes);
    else console.info(message, ...attributes);
  }

  warn(message: string, ...attributes: unknown[]): void {
    if (this.context) console.warn(this.context, message, ...attributes);
    else console.warn(message, ...attributes);
  }

  error(message: string, ...attributes: unknown[]): void {
    if (this.context) console.error(this.context, message, ...attributes);
    else console.error(message, ...attributes);
  }
}
