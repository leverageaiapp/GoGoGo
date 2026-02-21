import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import { bin as cloudflaredBin, install as installCloudflared } from 'cloudflared';

let tunnelProcess: ChildProcess | null = null;
let tunnelUrl: string | null = null;
let crashCallbacks: ((code: number | null) => void)[] = [];
let intentionalStop = false;

/**
 * Ensure cloudflared binary is available. Downloads it automatically if missing.
 */
async function ensureCloudflared(): Promise<string> {
    if (fs.existsSync(cloudflaredBin)) {
        return cloudflaredBin;
    }

    console.log('  cloudflared not found, downloading...');
    await installCloudflared(cloudflaredBin);
    console.log('  cloudflared installed.');
    return cloudflaredBin;
}

/**
 * Start Cloudflare Quick Tunnel
 * Returns the generated tunnel URL
 */
export async function startTunnel(localPort: number = 4020): Promise<string> {
    const binPath = await ensureCloudflared();

    return new Promise((resolve, reject) => {
        startTunnelProcess(binPath, localPort, resolve, reject);
    });
}

function startTunnelProcess(
    binPath: string,
    localPort: number,
    resolve: (url: string) => void,
    reject: (err: Error) => void
): void {
    // Inherit process.env (proxy vars already cleaned by session.ts)
    const env = { ...process.env };

    // Use --url for quick tunnel (no account needed)
    // Bypass proxy to avoid TLS handshake issues
    tunnelProcess = spawn(binPath, ['tunnel', '--url', `http://localhost:${localPort}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: env,
    });

    let urlFound = false;
    const timeout = setTimeout(() => {
        if (!urlFound) {
            reject(new Error('Timeout waiting for tunnel URL'));
            stopTunnel();
        }
    }, 30000); // 30 second timeout

    // cloudflared outputs the URL to stderr
    tunnelProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (urlMatch && !urlFound) {
            urlFound = true;
            clearTimeout(timeout);
            tunnelUrl = urlMatch[0];
            resolve(tunnelUrl);
        }
    });

    tunnelProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (urlMatch && !urlFound) {
            urlFound = true;
            clearTimeout(timeout);
            tunnelUrl = urlMatch[0];
            resolve(tunnelUrl);
        }
    });

    tunnelProcess.on('error', (err) => {
        clearTimeout(timeout);
        console.error('  [Tunnel] Failed to start:', err);
        reject(err);
    });

    tunnelProcess.on('close', (code) => {
        if (!urlFound) {
            clearTimeout(timeout);
            reject(new Error(`cloudflared exited with code ${code}`));
        } else if (!intentionalStop) {
            // Tunnel crashed after URL was found — notify listeners
            for (const cb of crashCallbacks) {
                cb(code);
            }
        }
        tunnelProcess = null;
        tunnelUrl = null;
        intentionalStop = false;
    });
}

export function stopTunnel(): void {
    if (tunnelProcess) {
        intentionalStop = true;
        tunnelProcess.kill('SIGTERM');
        tunnelProcess = null;
        tunnelUrl = null;
    }
    crashCallbacks = [];
}

/** Register a callback for when the tunnel crashes unexpectedly */
export function onTunnelCrash(callback: (code: number | null) => void): void {
    crashCallbacks.push(callback);
}
