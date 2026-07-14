# Privacy Policy — Epoch Converter

_Last updated: July 14, 2026_

Epoch Converter is a browser extension that converts Unix epoch timestamps to human-readable dates and back. This policy describes what data the extension accesses and what happens to it.

## What the extension accesses

- **Page text on domains you choose.** To highlight epoch timestamps, the extension runs its scanner only on pages of domains you have added to its list (localhost is included by default) — it does not run on any other site. Scanning happens entirely inside your browser. Page content is never recorded, stored, or transmitted anywhere.
- **Selected text.** When you use the right-click "Convert timestamp ⇄ date" menu, the text you selected is converted locally in your browser and shown in a tooltip. It is not stored or transmitted.
- **Clipboard (write only).** When you click a copy button, the converted value is written to your clipboard. The extension never reads your clipboard.

## What the extension stores

Two preferences, saved via Chrome's extension storage (`chrome.storage.sync`):

1. Your time format choice (24-hour or AM/PM)
2. Whether on-page timestamp highlighting is enabled
3. The list of domains you allowed for highlighting

If you are signed into Chrome with sync enabled, Chrome may sync these two settings across your own devices. That is the only data the extension stores.

## What the extension collects or shares

Nothing. The extension:

- makes **zero network requests** — it contains no code that communicates with any server;
- collects **no personal information, browsing history, or analytics**;
- contains **no ads, trackers, or third-party code**;
- **sells or shares nothing**, because it has nothing to sell or share.

## Changes to this policy

If a future version changes any of the above, this policy will be updated and the extension's store listing will reflect it.
