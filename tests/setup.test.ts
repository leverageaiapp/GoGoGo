import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');

describe('build artifacts', () => {
    it('dist/index.js exists', () => {
        expect(fs.existsSync(path.join(root, 'dist', 'index.js'))).toBe(true);
    });
});

describe('removed files do not exist', () => {
    it('src/capture.ts is deleted', () => {
        expect(fs.existsSync(path.join(srcDir, 'capture.ts'))).toBe(false);
    });

    it('src/context-extractor.ts is deleted', () => {
        expect(fs.existsSync(path.join(srcDir, 'context-extractor.ts'))).toBe(false);
    });

    it('src/voice-recognition-modelscope.ts is deleted', () => {
        expect(fs.existsSync(path.join(srcDir, 'voice-recognition-modelscope.ts'))).toBe(false);
    });

    it('src/relay.ts is deleted', () => {
        expect(fs.existsSync(path.join(srcDir, 'relay.ts'))).toBe(false);
    });

    it('src/config.ts is deleted', () => {
        expect(fs.existsSync(path.join(srcDir, 'config.ts'))).toBe(false);
    });
});

describe('no source file imports removed modules', () => {
    const srcFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts'));

    for (const file of srcFiles) {
        it(`${file} does not import capture`, () => {
            const content = fs.readFileSync(path.join(srcDir, file), 'utf-8');
            expect(content).not.toMatch(/from\s+['"]\.\/capture['"]/);
        });

        it(`${file} does not import context-extractor`, () => {
            const content = fs.readFileSync(path.join(srcDir, file), 'utf-8');
            expect(content).not.toMatch(/from\s+['"]\.\/context-extractor['"]/);
        });

        it(`${file} does not import voice-recognition-modelscope`, () => {
            const content = fs.readFileSync(path.join(srcDir, file), 'utf-8');
            expect(content).not.toMatch(/from\s+['"]\.\/voice-recognition-modelscope['"]/);
        });

        it(`${file} does not import relay`, () => {
            const content = fs.readFileSync(path.join(srcDir, file), 'utf-8');
            expect(content).not.toMatch(/from\s+['"]\.\/relay['"]/);
        });

        it(`${file} does not import config`, () => {
            const content = fs.readFileSync(path.join(srcDir, file), 'utf-8');
            expect(content).not.toMatch(/from\s+['"]\.\/config['"]/);
        });
    }
});

describe('pty.ts callback pattern', () => {
    const ptyContent = fs.readFileSync(path.join(srcDir, 'pty.ts'), 'utf-8');

    it('exports onLocalTerminalResize', () => {
        expect(ptyContent).toMatch(/export function onLocalTerminalResize/);
    });

    it('uses callback arrays instead of single callbacks', () => {
        expect(ptyContent).toMatch(/exitCallbacks/);
        expect(ptyContent).toMatch(/dataCallbacks/);
        expect(ptyContent).not.toMatch(/let dataCallback:/);
        expect(ptyContent).not.toMatch(/let exitCallback:/);
    });

    it('pushes to callback arrays in registration functions', () => {
        expect(ptyContent).toMatch(/exitCallbacks\.push\(callback\)/);
        expect(ptyContent).toMatch(/dataCallbacks\.push\(callback\)/);
    });

    it('removes stdin listener on killPTY', () => {
        expect(ptyContent).toMatch(/removeListener.*data.*stdinListener/s);
    });

    it('exports clearCallbacks for cleanup', () => {
        expect(ptyContent).toMatch(/export function clearCallbacks/);
    });
});

describe('web-server.ts callback lifecycle and WebSocket error handling', () => {
    const wsContent = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');

    it('imports onLocalTerminalResize and clearCallbacks from pty', () => {
        expect(wsContent).toMatch(/onLocalTerminalResize/);
        expect(wsContent).toMatch(/clearCallbacks/);
    });

    it('registers onLocalTerminalResize inside startWebServer, not at module level', () => {
        // The registration should be inside the startWebServer function body
        expect(wsContent).toMatch(/function startWebServer[\s\S]*?onLocalTerminalResize\(/);
        // There should be no module-level onLocalTerminalResize call
        const beforeStartFn = wsContent.split('function startWebServer')[0];
        expect(beforeStartFn).not.toMatch(/onLocalTerminalResize\(/);
    });

    it('has ws.on error handler per client', () => {
        expect(wsContent).toMatch(/ws\.on\(['"]error['"]/);
    });

    it('stopWebServer resets serverToken', () => {
        expect(wsContent).toMatch(/function stopWebServer[\s\S]*?serverToken\s*=\s*['"]['"]|serverToken\s*=\s*''/);
    });

    it('stopWebServer calls clearCallbacks', () => {
        expect(wsContent).toMatch(/function stopWebServer[\s\S]*?clearCallbacks\(\)/);
    });

    it('ping interval has null guard for wss', () => {
        expect(wsContent).toMatch(/if\s*\(wss\)\s*\{[\s\S]*?wss\.clients\.forEach/);
    });

    it('resize handler does not shadow clientInfo variable', () => {
        // Should NOT have "const clientInfo = connectedClients.get(ws)" inside resize handler
        expect(wsContent).not.toMatch(/type.*resize[\s\S]*?const clientInfo = connectedClients\.get/);
    });

    it('uses named constants for magic numbers', () => {
        expect(wsContent).toMatch(/BUFFER_TRIM_SIZE/);
        expect(wsContent).toMatch(/MAX_IMAGE_SIZE/);
        expect(wsContent).toMatch(/MAX_WS_PAYLOAD/);
        expect(wsContent).toMatch(/COOKIE_MAX_AGE/);
        expect(wsContent).toMatch(/CONTEXT_API_ENTRIES/);
    });

    it('express.json has explicit body size limit', () => {
        expect(wsContent).toMatch(/express\.json\(\s*\{\s*limit:/);
    });

    it('pty.ts uses /bin/sh as default shell fallback', () => {
        const ptyContent = fs.readFileSync(path.join(srcDir, 'pty.ts'), 'utf-8');
        expect(ptyContent).toMatch(/\/bin\/sh/);
        expect(ptyContent).not.toMatch(/\/bin\/zsh/);
    });
});

describe('ASR code fully removed', () => {
    it('public/js/terminal-asr.js is deleted', () => {
        expect(fs.existsSync(path.join(root, 'public', 'js', 'terminal-asr.js'))).toBe(false);
    });

    it('public/js/voice-input.js is deleted', () => {
        expect(fs.existsSync(path.join(root, 'public', 'js', 'voice-input.js'))).toBe(false);
    });

    it('web-server.ts has no ASR gateway URL', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        expect(content).not.toMatch(/voice\.futuretech\.social/);
    });

    it('web-server.ts has no asr_start handler', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        expect(content).not.toMatch(/asr_start/);
    });

    it('web-server.ts has no claude_process handler', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        expect(content).not.toMatch(/claude_process/);
    });

    it('web-server.ts has no debugAsr option', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        expect(content).not.toMatch(/debugAsr/);
    });

    it('index.html has no voice-btn', () => {
        const content = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf-8');
        expect(content).not.toMatch(/voice-btn/);
    });

    it('index.html has no terminal-asr.js script', () => {
        const content = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf-8');
        expect(content).not.toMatch(/terminal-asr\.js/);
    });

    it('terminal.js has no ASR references', () => {
        const content = fs.readFileSync(path.join(root, 'public', 'js', 'terminal.js'), 'utf-8');
        expect(content).not.toMatch(/asr_response/);
        expect(content).not.toMatch(/voiceInput/);
        expect(content).not.toMatch(/terminalASR/);
    });
});

describe('inline HTML replaced and deps removed', () => {
    it('web-server.ts is under 700 lines', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        const lineCount = content.split('\n').length;
        expect(lineCount).toBeLessThan(700);
    });

    it('web-server.ts contains error message for missing static files', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        expect(content).toMatch(/Static files not found/);
    });

    it('web-server.ts still has sendFile logic', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        expect(content).toMatch(/sendFile/);
    });

    it('package.json does not contain dotenv', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
        expect(pkg.dependencies).not.toHaveProperty('dotenv');
    });

    it('package.json does not contain eventsource', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
        expect(pkg.dependencies).not.toHaveProperty('eventsource');
    });

    it('package.json does not contain @types/eventsource', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
        expect(pkg.devDependencies).not.toHaveProperty('@types/eventsource');
    });
});

describe('image upload feature', () => {
    const wsContent = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
    const terminalJs = fs.readFileSync(path.join(root, 'public', 'js', 'terminal.js'), 'utf-8');

    it('web-server.ts handles image_upload message type', () => {
        expect(wsContent).toMatch(/image_upload/);
    });

    it('web-server.ts has temp cleanup with rmSync recursive', () => {
        expect(wsContent).toMatch(/rmSync.*recursive/);
    });

    it('web-server.ts maxPayload uses MAX_WS_PAYLOAD constant', () => {
        expect(wsContent).toMatch(/maxPayload:\s*MAX_WS_PAYLOAD/);
    });

    it('web-server.ts sanitizes filenames', () => {
        expect(wsContent).toMatch(/[^a-zA-Z0-9._-]/);
    });

    it('terminal.js has paste event listener', () => {
        expect(terminalJs).toMatch(/addEventListener\(['"]paste['"]/);
    });

    it('terminal.js handles image_uploaded response', () => {
        expect(terminalJs).toMatch(/image_uploaded/);
    });
});

describe('error handling and security fixes', () => {
    it('web-server.ts safeEqual uses constant-time comparison without length leak', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        expect(content).toMatch(/Buffer\.alloc\(maxLen\)/);
        expect(content).not.toMatch(/if \(a\.length !== b\.length\) return false/);
    });

    it('web-server.ts wraps origin URL parsing in try/catch', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        expect(content).toMatch(/try\s*\{[\s\S]*?new URL\(origin\)/);
        expect(content).toMatch(/Invalid origin/);
    });

    it('web-server.ts uses sameSite lax for cross-navigation cookie support', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        expect(content).toMatch(/sameSite:\s*['"]lax['"]/);
    });

    it('session.ts verifies server on /api/health', () => {
        const content = fs.readFileSync(path.join(srcDir, 'session.ts'), 'utf-8');
        expect(content).toMatch(/\/api\/health/);
        expect(content).not.toMatch(/localhost:\$\{port\}\/health[^/]/);
    });

    it('session.ts drains HTTP response in verifyServerStarted', () => {
        const content = fs.readFileSync(path.join(srcDir, 'session.ts'), 'utf-8');
        expect(content).toMatch(/res\.resume\(\)/);
    });

    it('session.ts defines cleanup before callback registrations', () => {
        const content = fs.readFileSync(path.join(srcDir, 'session.ts'), 'utf-8');
        const cleanupDef = content.indexOf('const cleanup');
        const onPTYExitCall = content.indexOf('onPTYExit(');
        const onTunnelCrashCall = content.indexOf('onTunnelCrash(');
        expect(cleanupDef).toBeGreaterThan(-1);
        expect(onPTYExitCall).toBeGreaterThan(-1);
        // cleanup must be defined before it's referenced in callbacks
        expect(cleanupDef).toBeLessThan(onPTYExitCall);
        expect(cleanupDef).toBeLessThan(onTunnelCrashCall);
    });

    it('session.ts registers signal handlers before tunnel/PTY setup', () => {
        const content = fs.readFileSync(path.join(srcDir, 'session.ts'), 'utf-8');
        const sigintPos = content.indexOf("process.once('SIGINT'");
        const tunnelPos = content.indexOf('startTunnel(');
        expect(sigintPos).toBeGreaterThan(-1);
        expect(tunnelPos).toBeGreaterThan(-1);
        expect(sigintPos).toBeLessThan(tunnelPos);
    });

    it('session.ts cleans up web server on tunnel failure', () => {
        const content = fs.readFileSync(path.join(srcDir, 'session.ts'), 'utf-8');
        // The tunnel catch block should call stopWebServer before process.exit
        expect(content).toMatch(/Failed to create tunnel[\s\S]*?stopWebServer\(\)[\s\S]*?process\.exit\(1\)/);
    });

    it('session.ts wraps spawnPTY in try/catch', () => {
        const content = fs.readFileSync(path.join(srcDir, 'session.ts'), 'utf-8');
        expect(content).toMatch(/try\s*\{[\s\S]*?spawnPTY\(/);
        expect(content).toMatch(/Failed to spawn command/);
    });

    it('session.ts uses /bin/sh as default shell fallback', () => {
        const content = fs.readFileSync(path.join(srcDir, 'session.ts'), 'utf-8');
        expect(content).toMatch(/\/bin\/sh/);
        expect(content).not.toMatch(/\/bin\/zsh/);
    });

    it('cloudflare-tunnel.ts exports onTunnelCrash', () => {
        const content = fs.readFileSync(path.join(srcDir, 'cloudflare-tunnel.ts'), 'utf-8');
        expect(content).toMatch(/export function onTunnelCrash/);
    });

    it('session.ts registers tunnel crash handler', () => {
        const content = fs.readFileSync(path.join(srcDir, 'session.ts'), 'utf-8');
        expect(content).toMatch(/onTunnelCrash/);
    });

    it('cloudflare-tunnel.ts uses intentionalStop flag to suppress crash callbacks on graceful shutdown', () => {
        const content = fs.readFileSync(path.join(srcDir, 'cloudflare-tunnel.ts'), 'utf-8');
        expect(content).toMatch(/intentionalStop/);
        // stopTunnel sets intentionalStop = true before killing
        expect(content).toMatch(/intentionalStop\s*=\s*true[\s\S]*?\.kill/);
        // close handler checks !intentionalStop before calling crash callbacks
        expect(content).toMatch(/!intentionalStop/);
    });

    it('cloudflare-tunnel.ts stopTunnel clears crashCallbacks', () => {
        const content = fs.readFileSync(path.join(srcDir, 'cloudflare-tunnel.ts'), 'utf-8');
        // stopTunnel should reset crashCallbacks to prevent accumulation
        expect(content).toMatch(/function stopTunnel[\s\S]*?crashCallbacks\s*=\s*\[\]/);
    });

    it('terminal.js wraps JSON.parse in try/catch', () => {
        const content = fs.readFileSync(path.join(root, 'public', 'js', 'terminal.js'), 'utf-8');
        expect(content).toMatch(/try\s*\{\s*msg\s*=\s*JSON\.parse/);
    });

    it('terminal.js handles exit message type', () => {
        const content = fs.readFileSync(path.join(root, 'public', 'js', 'terminal.js'), 'utf-8');
        expect(content).toMatch(/msg\.type\s*===\s*['"]exit['"]/);
    });

    it('terminal.js has no undeclared wasAtBottom', () => {
        const content = fs.readFileSync(path.join(root, 'public', 'js', 'terminal.js'), 'utf-8');
        expect(content).not.toMatch(/wasAtBottom/);
    });
});

describe('WebSocket security hardening', () => {
    const wsContent = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');

    it('has connection limit constant', () => {
        expect(wsContent).toMatch(/MAX_CONNECTIONS\s*=\s*\d+/);
    });

    it('enforces connection limit on new connections', () => {
        expect(wsContent).toMatch(/connectedClients\.size\s*>=\s*MAX_CONNECTIONS/);
    });

    it('has message rate limiting', () => {
        expect(wsContent).toMatch(/MSG_RATE_LIMIT/);
        expect(wsContent).toMatch(/msgCount/);
    });

    it('validates input message data type', () => {
        expect(wsContent).toMatch(/typeof msg\.data === ['"]string['"]/);
    });

    it('validates resize dimensions with bounds', () => {
        expect(wsContent).toMatch(/cols > 0 && cols <= 500/);
        expect(wsContent).toMatch(/rows > 0 && rows <= 200/);
    });

    it('validates image_upload data type', () => {
        // Should check typeof before Buffer.from
        expect(wsContent).toMatch(/image_upload.*typeof msg\.data === ['"]string['"]/s);
    });
});

describe('resource management and misc fixes', () => {
    it('web-server.ts trust proxy is set to 1 (not true)', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        expect(content).toMatch(/trust proxy.*1/);
        expect(content).not.toMatch(/trust proxy.*true/);
    });

    it('web-server.ts has HSTS header', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        expect(content).toMatch(/Strict-Transport-Security/);
    });

    it('web-server.ts has Permissions-Policy header', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        expect(content).toMatch(/Permissions-Policy/);
    });

    it('web-server.ts validates image file extension', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        expect(content).toMatch(/allowedExts/);
        expect(content).toMatch(/Unsupported image format/);
    });

    it('web-server.ts writes uploaded images with restricted permissions', () => {
        const content = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
        expect(content).toMatch(/writeFileSync.*mode.*0o600/s);
    });

    it('session.ts uses process.once for signal handlers', () => {
        const content = fs.readFileSync(path.join(srcDir, 'session.ts'), 'utf-8');
        expect(content).toMatch(/process\.once\(['"]SIGINT['"]/);
        expect(content).toMatch(/process\.once\(['"]SIGTERM['"]/);
        expect(content).not.toMatch(/process\.on\(['"]SIGINT['"]/);
    });

    it('session.ts cleanup has double-invocation guard', () => {
        const content = fs.readFileSync(path.join(srcDir, 'session.ts'), 'utf-8');
        expect(content).toMatch(/cleaningUp/);
    });

    it('index.ts has no allowUnknownOption', () => {
        const content = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf-8');
        expect(content).not.toMatch(/allowUnknownOption/);
    });

    it('index.ts has no config command', () => {
        const content = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf-8');
        expect(content).not.toMatch(/command\(['"]config['"]\)/);
        expect(content).not.toMatch(/from\s+['"]\.\/config['"]/);
    });
});

describe('project configuration quality', () => {
    it('package.json has files field to control published content', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
        expect(pkg.files).toBeDefined();
        expect(pkg.files).toContain('dist/');
        expect(pkg.files).toContain('public/');
    });

    it('tsconfig.json has noUnusedLocals enabled', () => {
        const tsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf-8'));
        expect(tsconfig.compilerOptions.noUnusedLocals).toBe(true);
    });

    it('tsconfig.json has noUnusedParameters enabled', () => {
        const tsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf-8'));
        expect(tsconfig.compilerOptions.noUnusedParameters).toBe(true);
    });

    it('tsconfig.json has noFallthroughCasesInSwitch enabled', () => {
        const tsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf-8'));
        expect(tsconfig.compilerOptions.noFallthroughCasesInSwitch).toBe(true);
    });

    it('index.html has lang attribute', () => {
        const content = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf-8');
        expect(content).toMatch(/<html\s+lang="/);
    });
});

describe('token auth replaces PIN auth', () => {
    const wsContent = fs.readFileSync(path.join(srcDir, 'web-server.ts'), 'utf-8');
    const sessionContent = fs.readFileSync(path.join(srcDir, 'session.ts'), 'utf-8');
    const indexContent = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf-8');

    it('web-server.ts has no generateLoginPage', () => {
        expect(wsContent).not.toMatch(/generateLoginPage/);
    });

    it('web-server.ts has no serverPIN', () => {
        expect(wsContent).not.toMatch(/serverPIN/);
    });

    it('web-server.ts has no failedAttempts', () => {
        expect(wsContent).not.toMatch(/failedAttempts/);
    });

    it('web-server.ts has no /api/login route', () => {
        expect(wsContent).not.toMatch(/\/api\/login/);
    });

    it('web-server.ts has serverToken', () => {
        expect(wsContent).toMatch(/serverToken/);
    });

    it('web-server.ts has verifyClient for WebSocket auth', () => {
        expect(wsContent).toMatch(/verifyClient/);
    });

    it('web-server.ts cookie is httpOnly', () => {
        expect(wsContent).toMatch(/httpOnly:\s*true/);
    });

    it('web-server.ts detects HTTPS for secure cookie', () => {
        expect(wsContent).toMatch(/isSecure/);
        expect(wsContent).toMatch(/x-forwarded-proto/);
    });

    it('web-server.ts applies requireAuth unconditionally', () => {
        // Should NOT have conditional "if (serverPIN)" before app.use(requireAuth)
        expect(wsContent).not.toMatch(/if\s*\(\s*serverPIN\s*\)/);
        expect(wsContent).toMatch(/app\.use\(requireAuth\)/);
    });

    it('session.ts uses crypto.randomBytes for token', () => {
        expect(sessionContent).toMatch(/crypto\.randomBytes/);
    });

    it('session.ts has no validatePIN', () => {
        expect(sessionContent).not.toMatch(/validatePIN/);
    });

    it('index.ts has no --pin option', () => {
        expect(indexContent).not.toMatch(/--pin/);
    });
});

describe('frontend defensive programming', () => {
    const terminalJs = fs.readFileSync(path.join(root, 'public', 'js', 'terminal.js'), 'utf-8');

    it('connect() calls updateStatus connecting', () => {
        expect(terminalJs).toMatch(/function connect\(\)\s*\{[\s\S]*?updateStatus\(['"]connecting['"]\)/);
    });

    it('setTimeout ws.send has null guard', () => {
        // The setTimeout callback for Enter key should re-check ws state
        expect(terminalJs).toMatch(/setTimeout\(\(\)\s*=>\s*\{[\s\S]*?ws && ws\.readyState === 1[\s\S]*?String\.fromCharCode\(13\)/);
    });

    it('uses != null for lastSeq check (not falsy)', () => {
        expect(terminalJs).toMatch(/msg\.seq\s*!=\s*null/);
        expect(terminalJs).toMatch(/msg\.lastSeq\s*!=\s*null/);
        // Should NOT have falsy check: if (msg.seq)
        expect(terminalJs).not.toMatch(/if\s*\(msg\.seq\)\s+lastSeq/);
    });

    it('validates msg.data type before term.write', () => {
        expect(terminalJs).toMatch(/typeof msg\.data === ['"]string['"].*term\.write/);
    });

    it('validates msg.data is array before forEach', () => {
        expect(terminalJs).toMatch(/Array\.isArray\(msg\.data\)/);
    });

    it('uses ?? instead of || for selectionStart', () => {
        expect(terminalJs).toMatch(/input\.selectionStart \?\?/);
        expect(terminalJs).not.toMatch(/input\.selectionStart \|\|/);
    });

    it('uses else if for mutually exclusive message types', () => {
        expect(terminalJs).toMatch(/else if \(msg\.type === ['"]history['"]\)/);
        expect(terminalJs).toMatch(/else if \(msg\.type === ['"]exit['"]\)/);
    });

    it('has shared uploadImageFile function (no duplicate paste logic)', () => {
        expect(terminalJs).toMatch(/function uploadImageFile\(file\)/);
        // Both paste handlers should call the shared function
        const uploadCalls = terminalJs.match(/uploadImageFile\(/g);
        expect(uploadCalls).not.toBeNull();
        expect(uploadCalls!.length).toBeGreaterThanOrEqual(3); // definition + input paste + native paste + file upload
    });

    it('has client-side image size check', () => {
        expect(terminalJs).toMatch(/MAX_CLIENT_IMAGE_SIZE/);
        expect(terminalJs).toMatch(/file\.size\s*>\s*MAX_CLIENT_IMAGE_SIZE/);
    });

    it('has FileReader onerror handler', () => {
        expect(terminalJs).toMatch(/reader\.onerror/);
    });

    it('wraps fitAddon.fit() in try-catch', () => {
        // All fitAddon.fit() calls should be wrapped
        expect(terminalJs).toMatch(/try\s*\{\s*fitAddon\.fit\(\)/);
        // Should NOT have bare fitAddon.fit() calls
        expect(terminalJs).not.toMatch(/[^{]\s*fitAddon\.fit\(\);\s*\n/);
    });

    it('uses polling for term.textarea instead of fixed setTimeout', () => {
        expect(terminalJs).toMatch(/waitForTextarea/);
        expect(terminalJs).not.toMatch(/setTimeout\(\(\)\s*=>\s*\{[\s\S]*?term\.textarea[\s\S]*?\},\s*500\)/);
    });

    it('validates base64 split result', () => {
        expect(terminalJs).toMatch(/parts\.length > 1/);
    });

    it('has mobile keyboard compensation using visualViewport', () => {
        expect(terminalJs).toMatch(/visualViewport/);
        expect(terminalJs).toMatch(/keyboardHeight/);
        // Must not send PTY resize when compensating for keyboard
        expect(terminalJs).not.toMatch(/keyboardHeight[\s\S]*?type:\s*['"]resize['"]/);
    });

    it('activateInputBoxMode restores terminal layout', () => {
        expect(terminalJs).toMatch(/function activateInputBoxMode[\s\S]*?updateTerminalBottom\(\)/);
    });

    it('cleans token from URL on page load', () => {
        expect(terminalJs).toMatch(/history\.replaceState/);
        expect(terminalJs).toMatch(/searchParams\.delete\(['"]token['"]\)/);
    });
});
