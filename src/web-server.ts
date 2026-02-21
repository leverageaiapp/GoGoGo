import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { writeToPTY, resizePTY, onPTYData, onPTYExit, getLocalSize, onLocalTerminalResize, clearCallbacks } from './pty';

let httpServer: ReturnType<typeof createServer> | null = null;
let wss: WebSocketServer | null = null;
let connectedClients: Map<WebSocket, { cols: number; rows: number; id: string }> = new Map();

// Token authentication state
let serverToken: string = '';

// Temp directory for uploaded images
let tempDir: string | null = null;

function getTempDir(): string {
    if (!tempDir) {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gogogo-img-'));
    }
    return tempDir;
}

// Terminal output buffer for new connections (with sequence numbers)
interface BufferEntry { seq: number; data: string; }
let outputBuffer: BufferEntry[] = [];
let nextSeq = 1;
const MAX_BUFFER_SIZE = 5000;
const BUFFER_TRIM_SIZE = 3000;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_WS_PAYLOAD = 6 * 1024 * 1024; // 6 MiB (just above image limit)
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const CONTEXT_API_ENTRIES = 50;

// Regex to detect clear-screen escape sequences
const CLEAR_SCREEN_RE = /\x1b\[[23]J|\x1bc/;

// WebSocket heartbeat interval
const WS_PING_INTERVAL = 30_000;
let pingInterval: ReturnType<typeof setInterval> | null = null;

// WebSocket limits
const MAX_CONNECTIONS = 10;
const MSG_RATE_WINDOW_MS = 1_000;
const MSG_RATE_LIMIT = 100; // max messages per window

// Generate unique client ID
let clientIdCounter = 0;
function generateClientId(): string {
    return `client-${Date.now()}-${++clientIdCounter}`;
}

// Calculate minimum size across all connected clients and local terminal
function calculateMinSize(): { cols: number; rows: number } {
    const local = getLocalSize();
    let minCols = local.cols;
    let minRows = local.rows;

    // Find minimum dimensions across all connected clients
    connectedClients.forEach((clientInfo) => {
        if (clientInfo.cols > 0 && clientInfo.rows > 0) {
            minCols = Math.min(minCols, clientInfo.cols);
            minRows = Math.min(minRows, clientInfo.rows);
        }
    });

    return { cols: minCols, rows: minRows };
}

// Apply minimum size to PTY
function applyMinSize(): void {
    if (connectedClients.size === 0) {
        // No web clients, use local size
        const local = getLocalSize();
        resizePTY(local.cols, local.rows);
        return;
    }

    const { cols, rows } = calculateMinSize();
    if (cols > 0 && rows > 0) {
        resizePTY(cols, rows);
    }
}

function safeEqual(a: string, b: string): boolean {
    // Pad both to same length to avoid leaking length via timing
    const maxLen = Math.max(a.length, b.length, 1);
    const aBuf = Buffer.alloc(maxLen);
    const bBuf = Buffer.alloc(maxLen);
    aBuf.write(a);
    bBuf.write(b);
    const match = crypto.timingSafeEqual(aBuf, bBuf);
    return match && a.length === b.length;
}

/**
 * Check if user is authenticated via cookie
 */
function isAuthenticated(req: express.Request): boolean {
    return req.cookies && req.cookies.auth && safeEqual(req.cookies.auth, serverToken!);
}

/**
 * Detect if connection is over HTTPS (direct or via proxy)
 */
function isSecure(req: express.Request): boolean {
    return req.protocol === 'https' || req.get('x-forwarded-proto') === 'https';
}

/**
 * Token authentication middleware
 * 1. ?token= query param match → set cookie + 302 redirect to clean URL
 * 2. Cookie valid → pass through
 * 3. Otherwise → 403
 */
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
    // Check for token in query parameter (first visit from QR code)
    const queryToken = req.query.token as string | undefined;
    if (queryToken && safeEqual(queryToken as string, serverToken!)) {
        // Set auth cookie and redirect to clean URL (without token)
        res.cookie('auth', serverToken, {
            httpOnly: true,
            secure: isSecure(req),
            maxAge: COOKIE_MAX_AGE,
            sameSite: 'lax'
        });
        // Build redirect URL without the token parameter
        const url = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
        url.searchParams.delete('token');
        const cleanPath = url.pathname + url.search;
        res.redirect(302, cleanPath);
        return;
    }

    // Check if authenticated via cookie
    if (isAuthenticated(req)) {
        next();
        return;
    }

    // Not authenticated
    res.status(403).send('Forbidden');
}

export function startWebServer(port: number, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // Set the server token
        serverToken = token;

        // Register local terminal resize callback (inside startWebServer, not at module level)
        onLocalTerminalResize(() => applyMinSize());

        const app = express();

        // Trust exactly 1 proxy hop (Cloudflare Tunnel)
        app.set('trust proxy', 1);

        app.use(cookieParser());
        app.use(express.json({ limit: '100kb' }));

        // Security headers
        app.use((req, res, next) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('Referrer-Policy', 'no-referrer');
            res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self' wss:; img-src 'self' data:");
            if (isSecure(req)) {
                res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
            }
            res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=()');
            next();
        });

        // Health check (no auth required)
        app.get('/api/health', (_req, res) => {
            res.json({ status: 'ok', timestamp: Date.now() });
        });

        // Apply authentication middleware (always enabled)
        app.use(requireAuth);

        app.get('/api/terminal-context', (_req, res) => {
            res.json({
                recentOutput: outputBuffer.slice(-CONTEXT_API_ENTRIES).map(e => e.data),
                bufferLength: outputBuffer.length,
            });
        });

        // Serve static files from public directory
        const publicDir = path.join(__dirname, '..', 'public');
        if (fs.existsSync(publicDir)) {
            app.use(express.static(publicDir));
        }

        // Fallback for SPA routing - use regex pattern for Express 5 compatibility
        app.use((req, res, next) => {
            // Skip API routes and WebSocket
            if (req.path.startsWith('/api') || req.path === '/ws') {
                return next();
            }

            // Skip static asset requests (favicon, images, etc.)
            const staticExtensions = ['.ico', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.css', '.js', '.map', '.woff', '.woff2', '.ttf', '.eot'];
            if (staticExtensions.some(ext => req.path.endsWith(ext))) {
                return res.status(404).end();
            }

            // Only serve index.html for HTML requests (browser navigation)
            const acceptHeader = req.get('Accept') || '';
            if (!acceptHeader.includes('text/html')) {
                return res.status(404).end();
            }

            const indexPath = path.join(publicDir, 'index.html');
            if (fs.existsSync(indexPath)) {
                res.sendFile(indexPath);
            } else {
                res.status(500).send('Static files not found. Try reinstalling with: npm install -g @leverageaiapps/gogogo');
            }
        });

        httpServer = createServer(app);

        // WebSocket server - verify authentication on upgrade
        wss = new WebSocketServer({
            server: httpServer,
            path: '/ws',
            maxPayload: MAX_WS_PAYLOAD,
            verifyClient: (info: { req: IncomingMessage; origin: string }, callback: (result: boolean, code?: number, message?: string) => void) => {
                // Verify Origin matches the server host
                const origin = info.origin || info.req.headers.origin || '';
                const host = info.req.headers.host || '';
                if (origin) {
                    try {
                        if (new URL(origin).host !== host) {
                            callback(false, 403, 'Origin mismatch');
                            return;
                        }
                    } catch {
                        callback(false, 403, 'Invalid origin');
                        return;
                    }
                }
                const cookieHeader = info.req.headers.cookie || '';
                const match = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('auth='));
                if (match && safeEqual(match.substring(5), serverToken!)) {
                    callback(true);
                    return;
                }
                callback(false, 403, 'Forbidden');
            }
        });

        // Heartbeat: ping all clients every 30s to keep Cloudflare tunnel alive
        pingInterval = setInterval(() => {
            if (wss) {
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.ping();
                    }
                });
            }
        }, WS_PING_INTERVAL);

        wss.on('connection', (ws) => {
            // Enforce connection limit
            if (connectedClients.size >= MAX_CONNECTIONS) {
                ws.close(1013, 'Too many connections');
                return;
            }

            const clientId = generateClientId();

            const clientInfo = { cols: 80, rows: 24, id: clientId, synced: false };
            connectedClients.set(ws, clientInfo);

            // Rate limiting state per connection
            let msgCount = 0;
            let msgWindowStart = Date.now();

            ws.on('message', async (data) => {
                // Rate limit check
                const now = Date.now();
                if (now - msgWindowStart > MSG_RATE_WINDOW_MS) {
                    msgCount = 0;
                    msgWindowStart = now;
                }
                if (++msgCount > MSG_RATE_LIMIT) {
                    return; // silently drop messages over limit
                }

                try {
                    const msg = JSON.parse(data.toString());

                    // Sync handshake: client sends lastSeq on connect
                    if (msg.type === 'sync' && !clientInfo.synced) {
                        clientInfo.synced = true;
                        const lastSeq = typeof msg.lastSeq === 'number' ? msg.lastSeq : 0;

                        if (outputBuffer.length === 0) {
                            // Nothing to send
                        } else if (lastSeq > 0 && lastSeq >= outputBuffer[0].seq) {
                            // Client has partial history — send only the delta
                            const delta = outputBuffer.filter(e => e.seq > lastSeq);
                            if (delta.length > 0) {
                                ws.send(JSON.stringify({
                                    type: 'history-delta',
                                    data: delta.map(e => e.data),
                                    lastSeq: delta[delta.length - 1].seq
                                }));
                            }
                        } else {
                            // First connect or lastSeq too old — send full history
                            ws.send(JSON.stringify({
                                type: 'history',
                                data: outputBuffer.map(e => e.data),
                                lastSeq: outputBuffer[outputBuffer.length - 1].seq
                            }));
                        }
                    }

                    if (msg.type === 'input' && typeof msg.data === 'string') {
                        writeToPTY(msg.data);
                    }

                    if (msg.type === 'resize') {
                        const cols = Number(msg.cols);
                        const rows = Number(msg.rows);
                        if (Number.isInteger(cols) && Number.isInteger(rows) &&
                            cols > 0 && cols <= 500 && rows > 0 && rows <= 200) {
                            clientInfo.cols = cols;
                            clientInfo.rows = rows;
                            applyMinSize();
                        }
                    }

                    if (msg.type === 'image_upload' && typeof msg.data === 'string') {
                        try {
                            const buf = Buffer.from(msg.data, 'base64');
                            if (buf.length > MAX_IMAGE_SIZE) {
                                ws.send(JSON.stringify({ type: 'image_uploaded', error: 'Image too large (max 5MB)' }));
                                return;
                            }
                            // Sanitize filename: allow only alphanumeric, dash, underscore, dot
                            const rawName = (msg.filename || 'clipboard.png').replace(/[^a-zA-Z0-9._-]/g, '_');
                            const allowedExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];
                            const ext = path.extname(rawName).toLowerCase() || '.png';
                            if (!allowedExts.includes(ext)) {
                                ws.send(JSON.stringify({ type: 'image_uploaded', error: 'Unsupported image format' }));
                                return;
                            }
                            const baseName = path.basename(rawName, ext).slice(0, 50);
                            const fileName = `${Date.now()}-${baseName}${ext}`;
                            const filePath = path.join(getTempDir(), fileName);
                            fs.writeFileSync(filePath, buf, { mode: 0o600 });
                            ws.send(JSON.stringify({ type: 'image_uploaded', path: filePath }));
                        } catch (imgErr: any) {
                            ws.send(JSON.stringify({ type: 'image_uploaded', error: 'Upload failed' }));
                        }
                    }
                } catch (e) {
                    console.error('  [WebServer] Invalid message:', e);
                }
            });

            ws.on('error', (_err) => {
                // Prevent uncaught error from crashing the process
                connectedClients.delete(ws);
            });

            ws.on('close', () => {
                connectedClients.delete(ws);
                // Recalculate minimum size after client disconnection
                applyMinSize();
            });
        });

        // Forward PTY output to all clients
        onPTYData((data) => {
            const seq = nextSeq++;
            outputBuffer.push({ seq, data });

            // Truncate buffer at the last clear-screen sequence
            if (CLEAR_SCREEN_RE.test(data)) {
                const matches = [...data.matchAll(/\x1b\[[23]J|\x1bc/g)];
                const last = matches[matches.length - 1];
                const after = data.slice(last.index! + last[0].length);
                outputBuffer = after ? [{ seq, data: after }] : [];
            } else if (outputBuffer.length > MAX_BUFFER_SIZE) {
                outputBuffer = outputBuffer.slice(-BUFFER_TRIM_SIZE);
            }

            const msg = JSON.stringify({ type: 'output', seq, data });
            connectedClients.forEach((_clientInfo, client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(msg);
                }
            });
        });


        // Notify clients on PTY exit
        onPTYExit((code) => {
            const msg = JSON.stringify({ type: 'exit', code });
            connectedClients.forEach((_clientInfo, client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(msg);
                }
            });
        });

        httpServer.listen(port, '0.0.0.0', () => {
            // Add a small delay to ensure the server is fully ready
            setTimeout(() => {
                resolve();
            }, 100);
        });

        httpServer.on('error', (err) => {
            console.error('  Failed to start server:', err);
            reject(err);
        });
    });
}

export function stopWebServer(): void {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }

    if (wss) {
        wss.clients.forEach((client) => client.close());
        wss.close();
        wss = null;
    }

    if (httpServer) {
        httpServer.close();
        httpServer = null;
    }

    connectedClients.clear();
    outputBuffer = [];
    nextSeq = 1;
    clientIdCounter = 0;
    serverToken = '';

    // Clear PTY callbacks registered by this module
    clearCallbacks();

    // Clean up temp image directory
    if (tempDir) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
        tempDir = null;
    }
}
