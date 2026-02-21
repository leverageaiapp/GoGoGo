# GoGoGo

[![npm version](https://img.shields.io/npm/v/@leverageaiapps/gogogo.svg)](https://www.npmjs.com/package/@leverageaiapps/gogogo)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

CLI tool to forward terminal sessions to your mobile device via Cloudflare Tunnel. **Code anywhere from your pocket.**

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue" alt="Platform">
</p>

## Features

- **Zero Config** - One command to start; `cloudflared` is downloaded automatically
- **Mobile Access** - Access your terminal from any device with a browser
- **Secure** - Cryptographic token auth with httpOnly cookies
- **No Port Forwarding** - Uses Cloudflare Quick Tunnel (no account needed)
- **Real-time** - WebSocket-based communication for instant feedback
- **PTY Support** - Full terminal emulation with node-pty
- **Image Paste** - Paste images from clipboard to upload file paths

## Installation

```bash
npm install -g @leverageaiapps/gogogo
```

**Verify Installation:**
```bash
gogogo --version
```

## Quick Start

```bash
# Start a terminal session
gogogo start

# Start with a specific command
gogogo start claude
gogogo start python
gogogo start vim
```

A QR code will appear - scan it with your phone to access your terminal. Authentication is automatic via a secure token embedded in the URL.

## Usage

### Basic Commands

```bash
# Start a terminal session (opens your default shell)
gogogo start

# Start with a machine name
gogogo start --name "My Laptop"

# Start a specific command
gogogo start claude
gogogo start "claude --dangerously-skip-permissions"
```

### Options

| Option | Short | Description |
|--------|-------|-------------|
| `--name <name>` | `-n` | Set a custom machine name (default: hostname) |
| `--version` | `-V` | Show version number |
| `--help` | `-h` | Show help |

## How It Works

1. Run `gogogo start [command]` in your terminal
2. GoGoGo starts a local web server and creates a Cloudflare tunnel
3. A QR code appears with your unique, authenticated URL
4. Scan the QR code with your phone
5. Your terminal is now accessible from your mobile device!

### Exiting

To exit GoGoGo, you can:
- Type `exit` in the terminal (or the command to exit your current program)
- Press `Ctrl+C` in the terminal where you ran `gogogo start`
- Close the terminal window

When you see **"Terminal session ended."**, the session has been successfully closed.

## Security

- **Token Authentication** - Each session gets a unique 128-bit cryptographic token
- **httpOnly Cookies** - Token is stored as a secure, httpOnly cookie after first visit
- **WebSocket Auth** - WebSocket connections are verified via cookie
- **Connection Limits** - Max 10 concurrent WebSocket connections
- **Rate Limiting** - Message rate limiting per connection
- **Security Headers** - CSP, HSTS, X-Frame-Options, and more

## Troubleshooting

### Error: posix_spawnp failed

Fix permissions on the node-pty spawn-helper:

```bash
# macOS ARM (M1/M2/M3)
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper

# macOS Intel
chmod +x node_modules/node-pty/prebuilds/darwin-x64/spawn-helper

# Linux x64
chmod +x node_modules/node-pty/prebuilds/linux-x64/spawn-helper
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) for secure tunneling
- [node-pty](https://github.com/microsoft/node-pty) for PTY support
- [xterm.js](https://xtermjs.org/) for terminal emulation in the browser
