/*
  @author Sven Wisotzky

  © 2026 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import type { Logger } from './logger';
import * as vscode from 'vscode';

export class OutputChannelLogger implements Logger {
  private logs: vscode.LogOutputChannel;
  private name: string;
  private context: string | undefined;

  /**
   * @param name UI-friendly name of the Output Channel used in VS Code
   */
  constructor(name: string) {
    this.logs = vscode.window.createOutputChannel(name, { log: true });
    this.name = name;
    this.context = undefined;
  }

  clone(): OutputChannelLogger {
    return new OutputChannelLogger(this.name);
  }

  setContext(context: string | undefined): void {
    this.context = context;
  }

  trace(message: string, ...attributes: unknown[]): void {
    if (this.context) this.logs.trace(this.context, message, ...attributes);
    else this.logs.trace(message, ...attributes);
  }

  debug(message: string, ...attributes: unknown[]): void {
    if (this.context) this.logs.debug(this.context, message, ...attributes);
    else this.logs.debug(message, ...attributes);
  }

  info(message: string, ...attributes: unknown[]): void {
    if (this.context) this.logs.info(this.context, message, ...attributes);
    else this.logs.info(message, ...attributes);
  }

  warn(message: string, ...attributes: unknown[]): void {
    if (this.context) this.logs.warn(this.context, message, ...attributes);
    else this.logs.warn(message, ...attributes);
  }

  error(message: string, ...attributes: unknown[]): void {
    if (this.context) this.logs.error(this.context, message, ...attributes);
    else this.logs.error(message, ...attributes);
  }

  show(): void {
    this.logs.show();
  }
}
