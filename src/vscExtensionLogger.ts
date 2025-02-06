/*
  @author Sven Wisotzky
  
  © 2025 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

import {Logger} from './logger';
import * as vscode from 'vscode';

export class ExtensionLogger implements Logger {
    private logs: vscode.LogOutputChannel;
    private name: string;
    private context: string | undefined;

    /**
     * @param name UI-friendly name of the OUTPUT Channel used in vsCode
     */

    constructor(name : string) {
        this.logs = vscode.window.createOutputChannel(name, {log: true});
        this.name = name;
        this.context = undefined;
    }

    clone(): ExtensionLogger {
        return new ExtensionLogger(this.name);
    }

    setContext(context: string|undefined) {
        this.context = context;
    }

    trace(message: string, ...attributes: any[]): void {
        if (this.context)
            this.logs.trace(this.context, message, ...attributes);
        else
            this.logs.trace(message, ...attributes);
    }

    debug(message: string, ...attributes: any[]): void {
        if (this.context)
            this.logs.debug(this.context, message, ...attributes);
        else
            this.logs.debug(message, ...attributes);
    }

    info(message: string, ...attributes: any[]): void {
        if (this.context)
            this.logs.info(this.context, message, ...attributes);
        else
            this.logs.info(message, ...attributes);
    }

    warn(message: string, ...attributes: any[]): void {
        if (this.context)
            this.logs.warn(this.context, message, ...attributes);
        else
            this.logs.warn(message, ...attributes);
    }

    error(message: string, ...attributes: any[]): void {
        if (this.context)
            this.logs.error(this.context, message, ...attributes);
        else
            this.logs.error(message, ...attributes);
    }

    show(): void {
        this.logs.show();
    }
}