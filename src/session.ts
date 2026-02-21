import * as crypto from 'crypto';
import * as qrcode from 'qrcode-terminal';
import * as net from 'net';
import * as http from 'http';
import { spawnPTY, killPTY, onPTYExit } from './pty';
import { startWebServer, stopWebServer } from './web-server';
import { startTunnel, stopTunnel, onTunnelCrash } from './cloudflare-tunnel';

const MIN_PORT = 8000;
const MAX_PORT = 65535;

/**
 * Check if a port is available
 */
function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.listen(port, () => {
            server.once('close', () => {
                resolve(true);
            });
            server.close();
        });
        server.on('error', () => {
            resolve(false);
        });
    });
}

/**
 * Find an available port in the specified range
 */
async function findAvailablePort(): Promise<number> {
    const maxAttempts = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const port = Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;

        if (await isPortAvailable(port)) {
            return port;
        }
    }

    throw new Error(`Unable to find available port after ${maxAttempts} attempts`);
}

/**
 * Verify that the web server is actually accessible
 */
function verifyServerStarted(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const maxAttempts = 10;
        let attempts = 0;

        const checkServer = () => {
            attempts++;

            const req = http.get(`http://localhost:${port}/api/health`, (res) => {
                res.resume(); // Drain response to free the socket
                resolve();
            });

            req.on('error', (_err) => {
                if (attempts >= maxAttempts) {
                    reject(new Error(`Server failed to start on port ${port} after ${maxAttempts} attempts`));
                } else {
                    // Try again after a short delay
                    setTimeout(checkServer, 200);
                }
            });

            req.setTimeout(1000, () => {
                req.destroy();
                if (attempts >= maxAttempts) {
                    reject(new Error(`Server startup timeout on port ${port}`));
                } else {
                    setTimeout(checkServer, 200);
                }
            });
        };

        checkServer();
    });
}

/**
 * Generate QR code for terminal
 */
function displayQRCode(url: string): void {
    console.log('');
    console.log('  📱 Scan this QR code with your phone:');
    console.log('');

    qrcode.generate(url, { small: true }, (qr) => {
        console.log(qr);
    });

    console.log('');
    console.log(`  📱 Or open: ${url}`);
    console.log('');
}

export async function startSession(_machineName: string, command?: string[]): Promise<void> {
    console.log('');

    // Bypass system proxy to avoid issues with Shadowrocket, Clash, etc.
    // These proxies can interfere with localhost connections
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;

    // Set NO_PROXY to ensure local connections bypass any remaining proxy
    process.env.NO_PROXY = 'localhost,127.0.0.1,*.local,*.trycloudflare.com';
    process.env.no_proxy = process.env.NO_PROXY;

    try {
        // Generate a cryptographically secure 128-bit token
        const authToken = crypto.randomBytes(16).toString('hex');

        // Show progress steps
        console.log('  Finding available port...');
        const port = await findAvailablePort();
        console.log(`  Using port: ${port}`);

        console.log('  Starting local server...');
        await startWebServer(port, authToken);

        // Verify server is accessible before creating tunnel
        await verifyServerStarted(port);

        // Cleanup function (defined early so all subsequent code can reference it)
        let cleaningUp = false;
        const cleanup = () => {
            if (cleaningUp) return;
            cleaningUp = true;
            killPTY();
            stopWebServer();
            stopTunnel();
            process.exit(0);
        };

        // Register signal handlers early to cover the entire setup phase
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);

        console.log('  Creating tunnel...');
        let tunnelUrl: string;

        try {
            tunnelUrl = await startTunnel(port);
        } catch (error) {
            console.log('');
            console.log('  ❌ Failed to create tunnel:');
            console.log('');
            console.log(error instanceof Error ? error.message : String(error));
            console.log('');
            stopWebServer();
            stopTunnel();
            process.exit(1);
        }

        // Display QR code and connection info (token embedded in URL)
        displayQRCode(`${tunnelUrl}/?token=${authToken}`);

        console.log('');
        console.log('  Started.');
        console.log('');

        // Determine what to run
        let commandToRun: string;
        let argsToRun: string[];

        if (command && command.length > 0) {
            // Check if first argument contains spaces (quoted command)
            if (command.length === 1 && command[0].includes(' ')) {
                // Single quoted command like "claude --dangerously-skip-permissions"
                const parts = command[0].split(' ');
                commandToRun = parts[0];
                argsToRun = parts.slice(1);
            } else {
                // Normal command with separate arguments
                commandToRun = command[0];
                argsToRun = command.slice(1);
            }
        } else {
            // No command provided, just start a shell
            const shell = process.env.SHELL || '/bin/sh';
            commandToRun = shell;
            argsToRun = [];
        }

        // Spawn the command in PTY
        try {
            spawnPTY({
                command: commandToRun,
                args: argsToRun,
                cwd: process.cwd(),
            });
        } catch (error) {
            console.error('  ✗ Failed to spawn command:', error instanceof Error ? error.message : String(error));
            stopWebServer();
            stopTunnel();
            process.exit(1);
        }

        // Handle tunnel crash
        onTunnelCrash((code) => {
            console.log('');
            console.log('  ⚠️  Tunnel disconnected unexpectedly (exit code: ' + code + ')');
            console.log('  Remote clients can no longer connect. Local terminal is still active.');
            console.log('');
        });

        // Handle command exit
        onPTYExit((_code) => {
            console.log('');
            if (command && command.length > 0) {
                console.log(`  ${command.join(' ')} exited. Session ended.`);
            } else {
                console.log('  Terminal session ended.');
            }
            cleanup();
        });

    } catch (error) {
        console.error('  ✗ Failed to start session:', error);
        stopWebServer();
        stopTunnel();
        process.exit(1);
    }
}
