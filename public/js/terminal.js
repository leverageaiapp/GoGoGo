// Clean token from URL after cookie-based auth is established
if (window.location.search.includes('token=')) {
    const url = new URL(window.location);
    url.searchParams.delete('token');
    history.replaceState(null, '', url.pathname + url.search);
}

// Theme management
const darkTheme = { background: '#0a0a0a', foreground: '#ededed', cursor: '#ededed', selectionBackground: '#3b82f644' };
const lightTheme = { background: '#f5f5f5', foreground: '#1a1a1a', cursor: '#1a1a1a', selectionBackground: '#2563eb44' };
let isLightTheme = (() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'light';
    try { return window.matchMedia('(prefers-color-scheme: light)').matches; } catch(e) { return false; }
})();

window.term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    smoothScrollDuration: 120,
    theme: isLightTheme ? lightTheme : darkTheme,
    scrollback: 10000,
    allowTransparency: false,
});

const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal-container'));
try { fitAddon.fit(); } catch(e) {}

const statusDot = document.getElementById('status-dot');
const input = document.getElementById('input');
const scrollBtn = document.getElementById('scroll-to-bottom');
const specialKeysBtn = document.getElementById('special-keys-btn');
const specialKeysPopup = document.getElementById('special-keys-popup');

let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
let isUserScrolling = false;
let lastSeq = 0; // track last received sequence number for delta sync
let nativeInputMode = false;

// Apply saved theme on load
function applyTheme(light) {
    const root = document.documentElement;
    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    if (light) {
        root.classList.add('light');
        term.options.theme = lightTheme;
        sunIcon.style.display = '';
        moonIcon.style.display = 'none';
    } else {
        root.classList.remove('light');
        term.options.theme = darkTheme;
        sunIcon.style.display = 'none';
        moonIcon.style.display = '';
    }
}
applyTheme(isLightTheme);

document.getElementById('theme-toggle').addEventListener('click', () => {
    isLightTheme = !isLightTheme;
    localStorage.setItem('theme', isLightTheme ? 'light' : 'dark');
    applyTheme(isLightTheme);
});

// Follow system theme changes when user hasn't manually overridden
try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        if (!localStorage.getItem('theme')) {
            isLightTheme = e.matches;
            applyTheme(isLightTheme);
        }
    });
} catch(e) {}

// Title sync — follow terminal escape sequences
const DEFAULT_TITLE = 'gogogo Terminal';
let terminalTitle = DEFAULT_TITLE;
term.onTitleChange((title) => {
    // Strip leading emoji — favicon handles branding
    terminalTitle = (title || DEFAULT_TITLE).replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]\s*/u, '');
    document.title = terminalTitle;
});

// Touch scrolling state
const terminalContainer = document.getElementById('terminal-container');
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// Dynamic input area height -> adjust terminal container bottom
const inputArea = document.getElementById('input-area');
function updateTerminalBottom() {
    const h = inputArea.offsetHeight;
    terminalContainer.style.bottom = h + 'px';
    scrollBtn.style.bottom = (h + 10) + 'px';
}

// Initialize touch scrolling for mobile devices
if (isTouchDevice) {
    initTouchScrolling(terminalContainer, () => { isUserScrolling = true; });
} else {
    // Desktop: click on terminal activates native input
    terminalContainer.addEventListener('click', (e) => {
        if (e.target.closest('#scroll-to-bottom')) return;
        activateNativeInput();
    });
}

// Switch back to input box mode when input is focused
input.addEventListener('focus', () => {
    activateInputBoxMode();
});

// Touch scrolling implementation for smooth mobile scrolling
function initTouchScrolling(container, onScrollStart) {
    const touchState = {
        startY: 0, lastY: 0, lastTime: 0,
        velocity: 0, identifier: null,
        touching: false, velocityHistory: [],
        accumulator: 0, inertiaId: null
    };

    // Create touch overlay
    const overlay = createTouchOverlay(container);

    // Attach event handlers
    overlay.addEventListener('touchstart', handleTouchStart, { passive: false });
    overlay.addEventListener('touchmove', handleTouchMove, { passive: false });
    overlay.addEventListener('touchend', handleTouchEnd, { passive: false });
    overlay.addEventListener('touchcancel', handleTouchCancel, { passive: false });

    // Prevent conflicts with input area
    const inputArea = document.getElementById('input-area');
    if (inputArea) {
        inputArea.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    }

    function createTouchOverlay(parent) {
        const div = document.createElement('div');
        Object.assign(div.style, {
            position: 'absolute', top: '0', left: '0', right: '0', bottom: '0',
            zIndex: '1', touchAction: 'none', webkitTouchCallout: 'none',
            webkitUserSelect: 'none', userSelect: 'none', pointerEvents: 'auto'
        });
        parent.appendChild(div);
        return div;
    }

    // Use xterm scrollLines API for v6 virtual scrolling
    let lineAccumulator = 0;
    function performScroll(deltaY) {
        lineAccumulator += deltaY;
        // Approximate line height for current font size
        const lineHeight = 17;
        const lines = Math.trunc(lineAccumulator / lineHeight);
        if (lines !== 0) {
            term.scrollLines(lines);
            lineAccumulator -= lines * lineHeight;
        }
    }

    function handleTouchStart(e) {
        e.preventDefault();
        cancelInertia();
        touchState.accumulator = 0;
        lineAccumulator = 0;

        if (e.touches.length > 0) {
            const touch = e.touches[0];
            Object.assign(touchState, {
                identifier: touch.identifier,
                startX: touch.clientX,
                startY: touch.clientY,
                lastY: touch.clientY,
                lastTime: performance.now(),
                startTime: performance.now(),
                velocity: 0,
                velocityHistory: [],
                touching: true,
                didMove: false
            });
            onScrollStart();
        }
    }

    function handleTouchMove(e) {
        e.preventDefault();
        if (!touchState.touching || e.touches.length === 0) return;

        const touch = findTrackedTouch(e.touches) || e.touches[0];
        const currentY = touch.clientY;
        const deltaY = touchState.lastY - currentY;
        const currentTime = performance.now();
        const timeDelta = Math.max(1, currentTime - touchState.lastTime);

        // Track if finger moved significantly (distinguishes tap from scroll)
        if (!touchState.didMove) {
            const dx = Math.abs(touch.clientX - touchState.startX);
            const dy = Math.abs(currentY - touchState.startY);
            if (dx > 10 || dy > 10) {
                touchState.didMove = true;
            }
        }

        // Update velocity
        updateVelocity(deltaY / timeDelta);

        touchState.lastY = currentY;
        touchState.lastTime = currentTime;
        touchState.accumulator += deltaY;

        // Apply scroll when threshold reached
        if (Math.abs(touchState.accumulator) >= 0.5) {
            performScroll(touchState.accumulator * 1.8);
            touchState.accumulator = touchState.accumulator % 0.5;
        }
    }

    function handleTouchEnd(e) {
        e.preventDefault();
        if (!isTouchEnded(e.touches)) return;

        const touchDuration = performance.now() - touchState.startTime;
        const wasTap = !touchState.didMove && touchDuration < 300;

        touchState.touching = false;
        touchState.identifier = null;

        if (wasTap) {
            // Short tap with no movement -> activate native input
            // Must blur input first to dismiss its caret on mobile
            input.blur();
            // Must call focus synchronously within user gesture for mobile keyboard
            term.focus();
            nativeInputMode = true;
            document.getElementById('input-area').classList.add('native-mode');
            return;
        }

        // Apply remaining scroll
        if (Math.abs(touchState.accumulator) > 0) {
            performScroll(touchState.accumulator * 1.8);
            touchState.accumulator = 0;
        }

        // Start inertia if needed
        if (Math.abs(touchState.velocity) > 0.01) {
            startInertia();
        }
    }

    function handleTouchCancel(e) {
        e.preventDefault();
        resetTouchState();
        cancelInertia();
    }

    function findTrackedTouch(touches) {
        for (let i = 0; i < touches.length; i++) {
            if (touches[i].identifier === touchState.identifier) {
                return touches[i];
            }
        }
        return null;
    }

    function isTouchEnded(touches) {
        return !findTrackedTouch(touches);
    }

    function updateVelocity(instant) {
        touchState.velocityHistory.push(instant);
        if (touchState.velocityHistory.length > 5) {
            touchState.velocityHistory.shift();
        }

        // Calculate weighted average
        let weightedSum = 0, totalWeight = 0;
        touchState.velocityHistory.forEach((v, i) => {
            const weight = i + 1;
            weightedSum += v * weight;
            totalWeight += weight;
        });
        touchState.velocity = totalWeight ? weightedSum / totalWeight : 0;
    }

    function startInertia() {
        const friction = 0.95;
        const minVelocity = 0.01;

        function animate() {
            if (Math.abs(touchState.velocity) < minVelocity || touchState.touching) {
                touchState.inertiaId = null;
                touchState.velocity = 0;
                return;
            }

            performScroll(touchState.velocity * 25);
            touchState.velocity *= friction;
            touchState.inertiaId = requestAnimationFrame(animate);
        }
        animate();
    }

    function cancelInertia() {
        if (touchState.inertiaId) {
            cancelAnimationFrame(touchState.inertiaId);
            touchState.inertiaId = null;
        }
    }

    function resetTouchState() {
        Object.assign(touchState, {
            touching: false, identifier: null,
            velocity: 0, velocityHistory: [],
            accumulator: 0
        });
    }
}

function setInputEnabled(enabled) {
    input.disabled = !enabled;
    input.style.opacity = enabled ? '1' : '0.5';
    input.style.cursor = enabled ? 'text' : 'not-allowed';
    if (!enabled) {
        input.placeholder = 'Reconnecting...';
    } else {
        input.placeholder = 'Type command...';
    }
}

function updateStatus(state) {
    statusDot.className = '';
    if (state === 'disconnected') {
        statusDot.classList.add('disconnected');
    } else if (state === 'connecting') {
        statusDot.classList.add('connecting');
    }
}

function connect() {
    updateStatus('connecting');
    // WebSocket will automatically include cookies with the request
    const wsUrl = location.protocol.replace('http', 'ws') + '//' + location.host + '/ws';
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected');
        updateStatus('connected');
        reconnectAttempts = 0;
        try { fitAddon.fit(); } catch(e) {}
        ws.send(JSON.stringify({ type: 'sync', lastSeq }));
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onclose = () => {
        console.log('WebSocket closed');
        updateStatus('disconnected');
        ws = null;
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            setTimeout(() => {
                connect();
            }, 500);
        } else {
            setInputEnabled(false);
            input.placeholder = 'Connection failed. Refresh page.';
        }
    };

    ws.onerror = (err) => {
        console.log('WebSocket error');
    };

    ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'output') {
            if (msg.seq != null) lastSeq = msg.seq;
            if (typeof msg.data === 'string') term.write(msg.data);
            checkScrollPosition();
        } else if (msg.type === 'history') {
            if (msg.lastSeq != null) lastSeq = msg.lastSeq;
            term.clear();
            if (Array.isArray(msg.data)) msg.data.forEach(d => term.write(d));
            setInputEnabled(true);
            setTimeout(() => { restoreScrollState(); }, 100);
        } else if (msg.type === 'history-delta') {
            if (msg.lastSeq != null) lastSeq = msg.lastSeq;
            if (Array.isArray(msg.data)) msg.data.forEach(d => term.write(d));
            setInputEnabled(true);
            checkScrollPosition();
        } else if (msg.type === 'exit') {
            term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
            setInputEnabled(false);
            input.placeholder = 'Process exited. Refresh page to restart.';
        } else if (msg.type === 'image_uploaded') {
            if (msg.error) {
                console.error('[Image] Upload error:', msg.error);
            } else if (msg.path) {
                if (nativeInputMode) {
                    if (ws && ws.readyState === 1) {
                        ws.send(JSON.stringify({ type: 'input', data: msg.path }));
                    }
                } else {
                    const pos = input.selectionStart ?? input.value.length;
                    const before = input.value.slice(0, pos);
                    const after = input.value.slice(pos);
                    const needSpace = before.length > 0 && !before.endsWith(' ');
                    input.value = before + (needSpace ? ' ' : '') + msg.path + (after.length > 0 && !after.startsWith(' ') ? ' ' : '') + after;
                    input.style.height = 'auto';
                    input.style.height = input.scrollHeight + 'px';
                    updateTerminalBottom();
                    input.focus();
                }
            }
        }
    };
}

// Input handling - must send text and Enter key separately for Claude Code to work
input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (ws && ws.readyState === 1) {
            const cmd = input.value;
            // Clear via execCommand so browser preserves undo history (Ctrl+Z to restore)
            input.focus();
            input.select();
            document.execCommand('delete');
            input.style.height = 'auto';
            updateTerminalBottom();
            if (cmd) {
                // Send text first, then Enter key separately after delay
                ws.send(JSON.stringify({ type: 'input', data: cmd }));
                setTimeout(() => {
                    if (ws && ws.readyState === 1) {
                        ws.send(JSON.stringify({ type: 'input', data: String.fromCharCode(13) }));
                    }
                }, 50);
            } else {
                // Just send Enter if empty
                ws.send(JSON.stringify({ type: 'input', data: String.fromCharCode(13) }));
            }
        }
    }
});

// Auto-resize textarea and adjust terminal container (no terminal refit)
function resizeInput() {
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
    updateTerminalBottom();
}
input.addEventListener('input', resizeInput);

// Shared image upload helper (used by both input textarea and native mode paste)
const MAX_CLIENT_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
function uploadImageFile(file) {
    if (!file) return;
    if (file.size > MAX_CLIENT_IMAGE_SIZE) {
        console.error('[Image] File too large (max 5MB):', file.name);
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        const parts = reader.result.split(',');
        const base64 = parts.length > 1 ? parts[1] : '';
        if (!base64) return;
        const ext = file.type.split('/')[1] || 'png';
        const filename = (file.name && file.name !== 'image.png') ? file.name : 'clipboard-' + Date.now() + '.' + ext;
        if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'image_upload', data: base64, filename: filename }));
        }
    };
    reader.onerror = () => {
        console.error('[Image] Failed to read file:', file.name);
    };
    reader.readAsDataURL(file);
}

// Paste image from clipboard
input.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image/') === 0) {
            e.preventDefault();
            uploadImageFile(items[i].getAsFile());
            return;
        }
    }
});

// File upload button (mobile fallback for image paste)
const fileUploadBtn = document.getElementById('file-upload-btn');
const fileUploadInput = document.getElementById('file-upload-input');
if (fileUploadBtn && fileUploadInput) {
    fileUploadBtn.addEventListener('click', () => fileUploadInput.click());
    fileUploadInput.addEventListener('change', () => {
        const file = fileUploadInput.files[0];
        if (file) uploadImageFile(file);
        fileUploadInput.value = '';
    });
}

// Special keys handling
specialKeysBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    specialKeysPopup.classList.toggle('show');
});

document.addEventListener('click', (e) => {
    if (!specialKeysPopup.contains(e.target) && e.target !== specialKeysBtn) {
        specialKeysPopup.classList.remove('show');
    }
});

document.querySelectorAll('.special-key').forEach(btn => {
    btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-key');
        handleSpecialKey(key);
        specialKeysPopup.classList.remove('show');
    });
});

function handleSpecialKey(key) {
    if (!ws || ws.readyState !== 1) return;

    const keyMap = {
        'Escape': '\x1b',
        'Tab': '\t',
        'Up': '\x1b[A',
        'Down': '\x1b[B',
        'Left': '\x1b[D',
        'Right': '\x1b[C',
        'Ctrl+C': '\x03',
        'Ctrl+D': '\x04',
        'Ctrl+Z': '\x1a',
        'Ctrl+L': '\x0c',
        'Home': '\x1b[H',
        'End': '\x1b[F',
        'PageUp': '\x1b[5~',
        'PageDown': '\x1b[6~',
        'F1': '\x1bOP',
        'F2': '\x1bOQ',
        'F3': '\x1bOR',
        'F4': '\x1bOS'
    };

    if (keyMap[key]) {
        ws.send(JSON.stringify({ type: 'input', data: keyMap[key] }));
    }
}

// Scroll handling - use xterm buffer API (works with v6's virtual scrolling)
function checkScrollPosition() {
    const buf = term.buffer.active;
    const atBottom = buf.viewportY >= buf.baseY;

    if (atBottom) {
        scrollBtn.classList.remove('visible');
        isUserScrolling = false;
    } else {
        scrollBtn.classList.add('visible');
    }

    // Save scroll state for reconnection recovery
    const state = {
        viewportY: buf.viewportY,
        baseY: buf.baseY,
        atBottom: atBottom
    };
    sessionStorage.setItem('scrollState', JSON.stringify(state));
}

function restoreScrollState() {
    const raw = sessionStorage.getItem('scrollState');
    if (!raw) {
        // First load - scroll to bottom
        term.scrollToBottom();
        isUserScrolling = false;
        return;
    }
    try {
        const state = JSON.parse(raw);
        if (state.atBottom) {
            term.scrollToBottom();
            isUserScrolling = false;
        } else {
            // Restore approximate position by offset from bottom
            const buf = term.buffer.active;
            const offsetFromBottom = state.baseY - state.viewportY;
            const targetLine = Math.max(0, buf.baseY - offsetFromBottom);
            term.scrollToLine(targetLine);
            isUserScrolling = true;
        }
        checkScrollPosition();
    } catch (e) {
        term.scrollToBottom();
    }
}

scrollBtn.addEventListener('click', () => {
    term.scrollToBottom();
    isUserScrolling = false;
    scrollBtn.classList.remove('visible');
});

// Monitor scroll via xterm API
term.onScroll(() => checkScrollPosition());
// Wheel event as supplement (user scrolling may not trigger term.onScroll immediately)
terminalContainer.addEventListener('wheel', () => {
    setTimeout(checkScrollPosition, 50);
});

// Window resize
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        updateTerminalBottom();
        try { fitAddon.fit(); } catch(e) {}
        if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
    }, 100);
});

// Initial layout
updateTerminalBottom();

// Mobile keyboard compensation for native input mode
// On iOS Safari, position:fixed body keeps full layout viewport height when
// the keyboard opens, so the keyboard covers the terminal bottom (cursor area).
// We use transform:translateY to shift the terminal container upward so the
// cursor area is visible above the keyboard. No PTY resize is sent.
if (isTouchDevice && window.visualViewport) {
    const vv = window.visualViewport;
    // Track the largest observed viewport height as "full" (no keyboard).
    let fullHeight = vv.height;
    let keyboardCompensating = false;

    function adjustForKeyboard() {
        // Update full height when viewport grows (keyboard closed, rotation, etc.)
        if (vv.height > fullHeight) fullHeight = vv.height;

        const keyboardHeight = fullHeight - vv.height;
        const isKeyboardOpen = keyboardHeight > 100;

        if (isKeyboardOpen && nativeInputMode) {
            keyboardCompensating = true;
            // Shift terminal container up so cursor area (at bottom) is visible
            // above the keyboard. The top portion scrolls off-screen.
            terminalContainer.style.transform = 'translateY(-' + keyboardHeight + 'px)';
            term.scrollToBottom();
        } else if (keyboardCompensating && !isKeyboardOpen) {
            keyboardCompensating = false;
            terminalContainer.style.transform = '';
        }
    }

    vv.addEventListener('resize', adjustForKeyboard);
    // iOS Safari sometimes fires scroll instead of resize during keyboard animation
    vv.addEventListener('scroll', adjustForKeyboard);
}

// Native input mode: forward xterm.js keyboard data directly to PTY
term.onData((data) => {
    if (nativeInputMode && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'input', data: data }));
    }
});

// Only let xterm.js process keyboard input when in native mode
term.attachCustomKeyEventHandler(() => nativeInputMode);

function activateNativeInput() {
    if (nativeInputMode) return;
    nativeInputMode = true;
    term.focus();
    document.getElementById('input-area').classList.add('native-mode');
}

function activateInputBoxMode() {
    if (!nativeInputMode) return;
    nativeInputMode = false;
    term.blur();
    document.getElementById('input-area').classList.remove('native-mode');
    // Restore terminal layout in case keyboard was compensating
    terminalContainer.style.transform = '';
    updateTerminalBottom();
}

// Auto-deactivate native mode when terminal loses focus
// Attach handlers to term.textarea via polling (more reliable than fixed timeout)
(function waitForTextarea() {
    if (!term.textarea) {
        setTimeout(waitForTextarea, 100);
        return;
    }
    term.textarea.addEventListener('blur', () => {
        setTimeout(() => {
            if (nativeInputMode && document.activeElement !== term.textarea) {
                activateInputBoxMode();
            }
        }, 100);
    });

    // Intercept image paste in native input mode (xterm.js focused)
    term.textarea.addEventListener('paste', (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image/') === 0) {
                e.preventDefault();
                e.stopPropagation();
                uploadImageFile(items[i].getAsFile());
                return;
            }
        }
    });
})();

// Initial connection
connect();
