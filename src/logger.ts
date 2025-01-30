/*
  @author Sven Wisotzky
  
  © 2025 Nokia
  Licensed under the BSD 3-Clause License
  SPDX-License-Identifier: BSD-3-Clause
*/

export interface Logger {
    clone(): Logger;

    setContext(context: string|undefined): void;

    trace(message: string, ...attributes: any[]): void;
    debug(message: string, ...attributes: any[]): void;
    info(message: string, ...attributes: any[]): void;
    warn(message: string, ...attributes: any[]): void;
    error(message: string, ...attributes: any[]): void;
}

export class ConsoleLogger implements Logger {
    private context: string | undefined;

    constructor () {
        this.context = undefined;
    }

    clone(): ConsoleLogger {
        return new ConsoleLogger();
    }

    setContext(context: string|undefined) {
        this.context = context;
    }

    trace(message: string, ...attributes: any[]): void {
        if (this.context)
            console.trace(this.context, message, ...attributes);
        else
            console.trace(message, ...attributes);
    }

    debug(message: string, ...attributes: any[]): void {
        if (this.context)
            console.debug(this.context, message, ...attributes);
        else
            console.debug(message, ...attributes);
    }

    info(message: string, ...attributes: any[]): void {
        if (this.context)
            console.info(this.context, message, ...attributes);
        else
            console.info(message, ...attributes);
    }

    warn(message: string, ...attributes: any[]): void {
        if (this.context)
            console.warn(this.context, message, ...attributes);
        else
            console.warn(message, ...attributes);
    }

    error(message: string, ...attributes: any[]): void {
        if (this.context)
            console.error(this.context, message, ...attributes);
        else
            console.error(message, ...attributes);
    }
}