# Heidi EMR Agent

Chrome Extension Side Panel that scans OpenEMR pages and auto-fills form fields using Gemini AI.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the extension:
   ```bash
   npm run build
   ```

3. Load in Chrome:
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

## Development

For development with hot reload:
```bash
npm run dev
```

Note: For Chrome extension testing, you'll need to rebuild after changes.

## Features

- Side Panel interface for OpenEMR
- Paste clinical notes from Heidi
- AI-powered form field detection and auto-fill
- Uses Gemini for intelligent field mapping

