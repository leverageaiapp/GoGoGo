import * as pty from 'node-pty';

export interface PTYOptions {
    cols?: number;
    rows?: number;
    command?: string;
    args?: string[];
    cwd?: string;
}

let ptyProcess: pty.IPty | null = null;
let dataCallbacks: ((data: string) => void)[] = [];
let exitCallbacks: ((code: number) => void)[] = [];
let resizeCallbacks: (() => void)[] = [];
let stdinListener: ((data: Buffer) => void) | null = null;
let resizeListener: (() => void) | null = null;

// Track local terminal size
let localCols = 80;
let localRows = 24;

// Get local terminal size
export function getLocalSize(): { cols: number; rows: number } {
    return { cols: localCols, rows: localRows };
}

export function spawnPTY(options: PTYOptions = {}): pty.IPty {
    // Default to user's shell
    const shell = process.env.SHELL || '/bin/sh';
    const command = options.command || shell;
    const args = options.args || [];
    localCols = options.cols || process.stdout.columns || 80;
    localRows = options.rows || process.stdout.rows || 24;
    const cwd = options.cwd || process.cwd();


    // Ensure we have a clean environment with PATH
    const env = {
        ...process.env,
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
        TERM: 'xterm-256color',
    } as { [key: string]: string };

    ptyProcess = pty.spawn(command, args, {
        name: 'xterm-256color',
        cols: localCols,
        rows: localRows,
        cwd,
        env,
    });

    // Handle PTY output - forward to both console and callbacks
    ptyProcess.onData((data) => {
        // Write to local terminal (mirror)
        process.stdout.write(data);

        // Also send to web client via callbacks
        for (const cb of dataCallbacks) {
            cb(data);
        }
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }) => {
        for (const cb of exitCallbacks) {
            cb(exitCode);
        }
        ptyProcess = null;
    });

    // Forward local stdin to PTY (for local terminal interaction)
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    // Remove previous stdin listener before adding new one
    if (stdinListener) {
        process.stdin.removeListener('data', stdinListener);
    }
    stdinListener = (data: Buffer) => {
        if (ptyProcess) {
            ptyProcess.write(data.toString());
        }
    };
    process.stdin.on('data', stdinListener);

    // Remove previous resize listener before adding new one
    if (resizeListener) {
        process.stdout.removeListener('resize', resizeListener);
    }
    resizeListener = () => {
        if (process.stdout.columns && process.stdout.rows) {
            localCols = process.stdout.columns;
            localRows = process.stdout.rows;
            for (const cb of resizeCallbacks) {
                cb();
            }
        }
    };
    process.stdout.on('resize', resizeListener);

    return ptyProcess;
}

export function writeToPTY(data: string): void {
    if (ptyProcess) {
        ptyProcess.write(data);
    }
}

export function resizePTY(cols: number, rows: number): void {
    if (ptyProcess) {
        ptyProcess.resize(cols, rows);
    }
}

export function killPTY(): void {
    if (ptyProcess) {
        ptyProcess.kill();
        ptyProcess = null;
    }

    // Remove stdin/resize listeners
    if (stdinListener) {
        process.stdin.removeListener('data', stdinListener);
        stdinListener = null;
    }
    if (resizeListener) {
        process.stdout.removeListener('resize', resizeListener);
        resizeListener = null;
    }

    // Restore terminal
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
    }
    process.stdin.pause();
}

export function onPTYData(callback: (data: string) => void): void {
    dataCallbacks.push(callback);
}

export function onPTYExit(callback: (code: number) => void): void {
    exitCallbacks.push(callback);
}

export function onLocalTerminalResize(callback: () => void): void {
    resizeCallbacks.push(callback);
}

/** Clear all registered callbacks (for cleanup/testing) */
export function clearCallbacks(): void {
    dataCallbacks = [];
    exitCallbacks = [];
    resizeCallbacks = [];
}
