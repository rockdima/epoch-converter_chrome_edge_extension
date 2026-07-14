# Epoch Converter

A Chrome / Edge extension (Manifest V3) that converts Unix epoch timestamps to human-readable dates and back — built for developers.

## Features

- **Epoch → date**: local, UTC, ISO 8601 and relative time; auto-detects seconds / milliseconds / microseconds / nanoseconds from the number's length
- **Date → epoch**: seconds and milliseconds, interpreted as local or UTC
- **On-page marking**: epoch values on your chosen domains get an amber highlight — hover for a conversion tooltip (local / utc / iso / relative), click a value to copy
- **Right-click convert**: select any timestamp or date string on any page → "Convert timestamp ⇄ date"
- **Live ticker**: current epoch in the popup, one click to copy
- **24h / am-pm** toggle (default 24h), dark editor-style monospace UI

## Domain allowlist

The on-page marker runs only on domains you allow — never on every site:

- `localhost` is enabled out of the box (http and https, any port)
- **Add the site you're on**: click the toolbar icon → `+ add <domain> (this tab)`
- **Add manually**: type a domain under `// marked domains` (supports `*.example.com` wildcards; pasted URLs are cleaned up automatically)
- **Remove** with ✕ next to a domain
- Changes apply to already-open tabs immediately — no refresh needed
- The list is saved in extension storage (`chrome.storage.sync`) and follows your Chrome profile

On first install, a short welcome page opens explaining this, and the toolbar icon shows a badge until the popup is opened once.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder

## Project layout

```
manifest.json                 MV3 manifest
popup/                        toolbar popup (converter UI + domain list)
content/                      on-page timestamp marker + hover tooltip
background/service-worker.js  context menu, dynamic content-script registration
welcome/                      first-run onboarding page
icons/                        16 / 48 / 128 px
store-assets/                 Chrome Web Store listing materials
```

## Privacy

No data is collected or transmitted — the extension makes zero network requests. It stores three settings (time format, marking on/off, allowed domains) in extension storage, and nothing else. See [PRIVACY.md](PRIVACY.md).
