# SyllabusSOS++ Operational Runbook (Cloudflare Tunnel)

This guide documents how to run, stop, back up, and troubleshoot the SyllabusSOS++ platform using free Cloudflare Quick Tunnels (`cloudflared`).

---

## 1. How to Start the Service

The project includes pre-configured automation scripts that initialize secrets, establish the Cloudflare tunnel, configure production environment variables, seed default data, and start the HTTP server.

### Windows (PowerShell)
Open PowerShell in the project directory (`syllabus-sos`) and execute:
```powershell
.\run-public.ps1
```
*(If PowerShell restricts script execution, run: `powershell -ExecutionPolicy Bypass -File .\run-public.ps1`)*

### Linux / macOS (Bash)
Open terminal in the project directory and run:
```bash
chmod +x ./run-public.sh
./run-public.sh
```

Upon launching, the script prints:
- The public `https://*.trycloudflare.com` URL (accessible from any phone or computer worldwide)
- The Administrator email
- The database storage location

---

## 2. How to Stop the Service

To stop both the Node.js server and the Cloudflare background tunnel:
- Press `Ctrl + C` in the PowerShell / terminal window running the script.
- The script automatically catches the termination signal and shuts down both `node` and `cloudflared`.

If you ever need to manually terminate running processes in PowerShell:
```powershell
Stop-Process -Name node, cloudflared -Force -ErrorAction SilentlyContinue
```

---

## 3. How to Back Up and Restore Data

All platform data is stored locally in SQLite and flat files:
- **Database file**: `data/syllabussos.db` (contains users, universities, syllabus, courses, topics, credits ledger, sessions, bookings)
- **Local credentials**: `.env.local` (contains persistent `APP_SECRET` and `ADMIN_EMAIL`)

### Creating a Backup
Ensure the server is stopped or idle, then copy the `data/` directory and `.env.local`:
```powershell
# In PowerShell:
Copy-Item -Path data -Destination data-backup-$(Get-Date -Format 'yyyyMMdd-HHmm') -Recurse
Copy-Item -Path .env.local -Destination .env.local.backup
```

### Restoring from Backup
```powershell
Copy-Item -Path data-backup-*\syllabussos.db -Destination data\syllabussos.db -Force
```

---

## 4. What to Do When the Tunnel Address Changes

Free Cloudflare Quick Tunnels allocate a new temporary address (e.g. `https://random-words.trycloudflare.com`) every time the tunnel restarts.

- **No re-configuration required**: `run-public.ps1` automatically captures the new URL on startup and injects it into `PUBLIC_URL` and `ALLOWED_HOSTS`.
- **Data remains intact**: Your database (`data/syllabussos.db`) and `APP_SECRET` persist on your disk. All student registrations, teacher approvals, tutor profiles, and balances remain completely intact.
- **Sharing the new link**: Simply copy the new `https://*.trycloudflare.com` address printed by the script and share it with your users.

---

## 5. Troubleshooting Guide

| Issue | Cause | Resolution |
| :--- | :--- | :--- |
| **Login fails with 403 "Origin not allowed" or 421 "Unknown host"** | Mismatch between the browser's accessed URL and the server's `PUBLIC_URL` / `ALLOWED_HOSTS`. | The platform enforces strict CSRF origin and host verification. Always launch via `run-public.ps1` (or `run-public.sh`), which sets `PUBLIC_URL` to the exact active tunnel URL. Do not access an old tunnel link after restarting. |
| **Tunnel connection drops suddenly** | Laptop entered sleep mode, hibernated, or switched Wi-Fi networks. | Cloudflare tunnels require an active, uninterrupted outbound connection to Cloudflare edge servers. When waking your machine, press `Ctrl+C` in the terminal and start the script again with `.\run-public.ps1`. |
| **`cloudflared: command not found`** | Cloudflare CLI is not installed or not in PATH. | Install it via Windows Package Manager: `winget install --id Cloudflare.cloudflared`. Restart your terminal or verify with `cloudflared --version`. |
| **Port 3000 in use (`EADDRINUSE`)** | A previous Node instance is still running in the background. | In PowerShell run: `Get-Process node \| Stop-Process -Force`. Then rerun `.\run-public.ps1`. |
| **"ADMIN_PASSWORD must be at least 12 characters"** | Provided password is too short or weak. | Pass an admin password of at least 12 characters that does not contain the username or common dictionary patterns. |
| **Rate limit exceeded (`429 Too many requests`)** | Rapid automated requests triggered the in-memory rate limiter. | Wait 1-2 minutes for the window to slide, or restart the server process to clear in-memory rate counters. |
