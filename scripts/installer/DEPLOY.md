# AOP Binary Distribution — Deploy Guide

## Overview

AOP ships as a single compiled binary containing CLI + local-server + dashboard + SQLite.
Users install via `curl -fsSL https://getaop.com/install.sh | sh`.

Binaries are served as static files from `getaop.com`. No API needed.

## Server File Structure

```
/var/www/getaop.com/
  install.sh                    ← install script (~3KB)
  latest/
    version                     ← plain text: "0.1.0"
  v0.1.0/
    aop-linux-x64               ← ~97MB
    aop-linux-arm64
    aop-darwin-x64
    aop-darwin-arm64
    checksums.sha256
```

## Server Setup (One-Time)

### 1. Provision a VPS

Any cheap VPS works (Hetzner, DigitalOcean, etc.). Requirements:

- ~2GB disk per release (4 binaries x ~97MB each + checksums)
- SSH access
- HTTPS via Let's Encrypt

### 2. Point DNS

Create an A record for `getaop.com` pointing to the VPS IP.

### 3. Install nginx

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
```

### 4. Configure nginx

```bash
sudo tee /etc/nginx/sites-available/getaop.com << 'NGINX'
server {
    listen 80;
    server_name getaop.com;
    root /var/www/getaop.com;

    location / {
        try_files $uri $uri/ =404;
    }

    # Correct MIME type for install script
    location = /install.sh {
        default_type text/plain;
    }

    # Correct MIME type for version file
    location = /latest/version {
        default_type text/plain;
    }

    # Binary downloads — force download, disable buffering for large files
    location ~ ^/v[^/]+/aop- {
        default_type application/octet-stream;
        add_header Content-Disposition "attachment";
        sendfile on;
        tcp_nopush on;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/getaop.com /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 5. Enable HTTPS

```bash
sudo certbot --nginx -d getaop.com
```

### 6. Create the web root

```bash
sudo mkdir -p /var/www/getaop.com/latest
sudo chown -R $USER:$USER /var/www/getaop.com
```

## Releasing a New Version

### Build

```bash
# Build all 4 platform binaries (linux/darwin x x64/arm64)
bun run build:release

# Or build a single platform for testing
bun run build:release -- --target linux-x64
```

Output goes to `dist/release/`:

```
dist/release/
  aop-linux-x64
  aop-linux-arm64
  aop-darwin-x64
  aop-darwin-arm64
  checksums.sha256
  dashboard/
```

### Verify

```bash
# Check version endpoint
curl https://getaop.com/latest/version

# Test install script (dry run — read the output before piping to sh)
curl -fsSL https://getaop.com/install.sh

# Full install
curl -fsSL https://getaop.com/install.sh | sh
```

## How the Install Script Works

1. Detects OS (`uname -s`) and arch (`uname -m`)
2. Fetches latest version from `https://getaop.com/latest/version`
3. Downloads binary from `https://getaop.com/v{version}/aop-{os}-{arch}`
4. Downloads `checksums.sha256` and verifies the binary hash
5. Installs to `/usr/local/bin/aop` (or `~/.local/bin/aop` if no write access)
6. Checks for `git` and `claude` in PATH, warns if missing

Users can pin a version: `curl -fsSL https://getaop.com/install.sh | sh -s -- --version 0.1.0`

## Local Testing

Test the binary without deploying:

```bash
# Build for current platform
bun run build:release -- --target linux-x64

# Version check
./dist/release/aop-linux-x64 --version

# Start server (foreground)
./dist/release/aop-linux-x64 run

# Start server (background)
./dist/release/aop-linux-x64 run --background
./dist/release/aop-linux-x64 status
./dist/release/aop-linux-x64 stop

# Dashboard is served at http://localhost:3847/
```

## Notes

- **Binary size**: ~97MB per platform (Bun runtime is embedded)
- **SQLite**: Bundled in the Bun runtime, no external dependency
- **Dashboard**: Pre-built and embedded in the binary, served automatically
- **Data directory**: `~/.aop/` (database, logs, PID file)
- **macOS Gatekeeper**: Unsigned binary triggers a warning. Workaround: `xattr -d com.apple.quarantine ./aop`
- **No Windows support**: Bun compile doesn't support Windows yet
