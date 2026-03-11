---
name: homey
description: |
  Homey widget development for dashboard apps. Triggers on: Homey CLI, widgets,
  widget settings, widget styling, widget debugging, homey app create, homey app run,
  homey app publish, dashboard widgets, Homey App SDK.

  Use when user: creates widgets, configures widget settings, styles widgets with Homey CSS,
  debugs widgets on Android/iOS, publishes to Homey App Store, or works with Homey apps.
---

# Homey Widget Development Skill

Build custom dashboard widgets for Homey smart home platform. Widgets are webviews (HTML/CSS/JS) displayed on user dashboards with access to the Homey API.

> **Compatibility**: Widgets require Homey Pro with SDK `>=12.3.0`. Not available on Homey Cloud.

## Prerequisites

1. **Node.js** v18 or higher
2. **Docker** (required for Homey Cloud and Homey Pro Early 2023)
3. **Homey CLI**: `pnpm add -g homey`

## Quick Decision Trees

### "I need to create a Homey app"

```
Create app?
├─ New app from scratch → homey app create
├─ Add widget to existing app → homey app widget create
├─ Run app on Homey → homey app run
├─ Install without terminal → homey app install
└─ Publish to App Store → homey app publish
```

### "I need to configure widget settings"

```
Widget settings?
├─ Text input → type: "text"
├─ Multi-line text → type: "textarea"
├─ Number input → type: "number" (with optional min/max)
├─ Selection dropdown → type: "dropdown"
├─ Toggle option → type: "checkbox"
└─ Search with suggestions → type: "autocomplete"
```

### "I need to style a widget"

```
Styling?
├─ Text styling → Use .homey-text-* classes
├─ Colors → Use --homey-color-* variables
├─ Light/dark mode → Automatic, or force with .homey-dark-mode
├─ Spacing → Use --homey-space-* units
└─ Icons → Use .homey-icon class with custom SVG
```

---

## CLI Commands Reference

### App Management

```bash
# Create new Homey app (interactive)
homey app create

# Run app on Homey (dev mode with hot reload for public/ files)
homey app run

# Install app without keeping terminal open
homey app install

# Validate app before publishing
homey app validate

# Publish to Homey App Store
homey app publish
```

### Widget Management

```bash
# Create a new widget (run from app directory)
homey app widget create
```

### Authentication & Selection

```bash
# Login to Athom account
homey login

# Logout
homey logout

# Select different Homey device
homey select

# View all commands
homey --help
homey app --help
```

---

## Widget Structure

When you run `homey app widget create`, it creates:

```
widgets/<widgetId>/
├── widget.compose.json    # Widget definition and settings
├── public/
│   └── index.html         # Widget entry point (and other assets)
├── api.js                  # Backend API implementation
├── preview-dark.png        # Preview image for dark mode (1024x1024)
└── preview-light.png       # Preview image for light mode (1024x1024)
```

### widget.compose.json

```json
{
  "name": { "en": "My Widget" },
  "settings": [
    {
      "id": "my-setting",
      "type": "dropdown",
      "title": { "en": "Select Option" },
      "value": "option1",
      "values": [
        { "id": "option1", "title": { "en": "Option 1" } },
        { "id": "option2", "title": { "en": "Option 2" } }
      ]
    }
  ],
  "height": 200,
  "transparent": false,
  "api": {
    "getData": { "method": "GET", "path": "/" },
    "setData": { "method": "POST", "path": "/" }
  }
}
```

**Key Properties:**
- `height`: Initial height in pixels, or percentage (e.g., `"100%"` = square)
- `transparent`: Set `true` for transparent background
- `api`: Define endpoints accessible via `Homey.api`
- `deprecated`: Set `true` to hide from widget picker (existing instances still work)

### Setting Types

| Type | Value | Description |
|------|-------|-------------|
| `text` | `string \| null` | Single line text, optional `pattern` for regex validation |
| `textarea` | `string \| null` | Multi-line text |
| `number` | `number \| null` | Numeric input, optional `min`/`max` |
| `dropdown` | `string \| null` | Select from predefined `values` array |
| `checkbox` | `boolean \| null` | Toggle true/false |
| `autocomplete` | `object \| null` | Search with suggestions |

---

## Widget View API

In your `index.html`, use the global `Homey` object:

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://apps-sdk.developer.homey.app/css/homey.widgets.css">
  <script src="https://apps-sdk.developer.homey.app/js/homey.widgets.js"></script>
</head>
<body>
  <div id="content"></div>
  <script>
    async function init() {
      // Get user settings
      const settings = await Homey.getSettings();
      
      // Call your backend API
      const data = await Homey.api('GET', '/');
      
      // Listen for app events
      Homey.on('update', (data) => {
        console.log('Received update:', data);
      });
      
      // Set dynamic height
      Homey.setHeight(250);
      
      // Translation
      const text = Homey.__('settings.title');
      
      // Signal widget is ready (removes loading state)
      Homey.ready();
    }
    
    init();
  </script>
</body>
</html>
```

### API Methods

| Method | Description |
|--------|-------------|
| `Homey.ready({ height?: number })` | Signal widget is ready, optionally set height |
| `Homey.api(method, path, body?)` | Call widget API endpoints |
| `Homey.on(event, callback)` | Listen for app-emitted events |
| `Homey.__(key, tokens?)` | Translate string from `/locales/*.json` |
| `Homey.getWidgetInstanceId()` | Get unique instance ID |
| `Homey.getSettings()` | Get user-configured settings |
| `Homey.setHeight(height)` | Change widget height at runtime |
| `Homey.popup(url)` | Open in-app browser |
| `Homey.hapticFeedback()` | Trigger haptic feedback (call after touch event) |

---

## Widget Styling

Always include the Homey CSS:

```html
<link rel="stylesheet" href="https://apps-sdk.developer.homey.app/css/homey.widgets.css">
```

### Text Presets

```css
.homey-text-bold       /* Titles, important text */
.homey-text-medium     /* Subtitles, emphasis */
.homey-text-regular    /* Default body text */
.homey-text-small      /* Small standalone text */
.homey-text-small-light /* Small text next to other text */
```

### Font Variables

```css
/* Font sizes */
--homey-font-size-xxlarge  /* 32px - numbers only */
--homey-font-size-xlarge   /* 24px - short phrases */
--homey-font-size-large    /* 20px - numbers only */
--homey-font-size-default  /* 17px - most text */
--homey-font-size-small    /* 14px - captions */

/* Line heights (match with font size) */
--homey-line-height-xxlarge  /* 40px */
--homey-line-height-xlarge   /* 32px */
--homey-line-height-large    /* 28px */
--homey-line-height-default  /* 24px */
--homey-line-height-small    /* 20px */

/* Font weights */
--homey-font-weight-bold     /* Titles */
--homey-font-weight-medium   /* Emphasis */
--homey-font-weight-regular  /* Default */
```

### Color Palette

```css
/* Semantic colors */
--homey-text-color
--homey-background-color
--homey-color-highlight
--homey-color-success
--homey-color-warning
--homey-color-danger

/* Grayscale (000=white to 1000=black in light mode) */
--homey-color-mono-000 to --homey-color-mono-1000

/* Accent colors (050-900) */
--homey-color-blue-500
--homey-color-green-500
--homey-color-orange-500
--homey-color-red-500
```

### Light/Dark Mode

```css
/* Force dark mode */
.homey-dark-mode

/* Check if dark mode (in CSS) */
.homey-dark-mode .my-element { ... }
```

### Spacing

```css
--homey-space-10-5   /* 0.5 units */
--homey-space-11     /* 1 unit */
--homey-space-11-5   /* 1.5 units */
--homey-space-12     /* 2 units */
/* etc. */

/* Widget padding */
--homey-widget-padding
```

---

## Backend API (api.js)

```javascript
'use strict';

module.exports = {
  async getData({ homey, params, query, body }) {
    // Access Homey instance
    const devices = await homey.devices.getDevices();
    
    // Return data to widget
    return { devices: Object.keys(devices) };
  },
  
  async setData({ homey, params, query, body }) {
    // Handle POST data
    homey.log('Received:', body);
    return { success: true };
  }
};
```

---

## Debugging

### Development Mode

```bash
# Run with hot reload for public/ folder
homey app run
```

A refresh button appears to reload `index.html` without full restart.

### Android Debugging

1. Enable USB debugging on Android device
2. Connect via USB or same WiFi network
3. Open `chrome://inspect` in Chrome
4. Find and inspect your widget webview

### iOS Debugging

1. Enable Web Inspector in iOS Settings → Safari → Advanced
2. Connect device to Mac
3. Open Safari → Develop → [Device] → [Widget]

---

## App Store Publishing

### Required Assets

| Asset | Size | Format |
|-------|------|--------|
| App icon | 1024x1024 | PNG (transparent bg) | Required for install |
| App image small | 250x175 | JPG/PNG | **Required for publish validation** |
| App image large | 500x350 | JPG/PNG | **Required for publish validation** |
| App image xlarge | 1000x700 | JPG/PNG | Optional but recommended |
| Widget preview | 1024x1024 | PNG (transparent bg) | Required for widget list |

### Validation Levels

```bash
# Debug level (development)
homey app validate --level debug

# Publish level (Homey Pro)
homey app validate --level publish

# Verified level (Homey Cloud)
homey app validate --level verified
```

### Publishing Process

1. Validate app: `homey app validate --level publish`
2. Publish: `homey app publish`
    - **Interactive**: This command will prompt you to select a new version (Patch/Minor/Major) or confirm the current one.
    - **Monorepo**: In a script, you may need to handle this interactivity (e.g. via `turbo` with concurrency 1).
3. Go to [tools.developer.homey.app](https://tools.developer.homey.app)
4. Submit for Test or Live certification
5. Wait for Athom review

### Widget Preview Guidelines

- Use [Figma template](https://www.figma.com/community/file/1392859749687789493/widget-previews-template)
- Transparent background
- Simple shapes, no text
- Both light and dark versions
- 1024x1024 dimensions

### README.txt (Store Page Description)

The `README.txt` file is a **plain-text story** displayed on the App Store page below the app name and description. It describes what the app does in a friendly, non-technical way.

**Format rules:**
- Plain text only — **no markdown**, no URLs, no changelogs
- Do not repeat the app name (it already shows above the README on the store)
- Describe the app's possibilities, not its technical implementation
- Write in a friendly, engaging tone aimed at end users
- **Avoid specific counts**: Use "multiple" or "various" instead of exact numbers (e.g. "7 widgets") so the text stays accurate long-term

**Description field (`app.json`):**
- The `description` field is a short, catchy tagline shown below the app name
- Be specific (avoid generic phrases like "adds support for X")
- Always include both `en` and `nl` translations

---

## Homey Compose

Homey Compose splits the app manifest into modular files that get merged into the root `app.json` during pre-processing.

### How it works

1. **`.homeycompose/app.json`** — The **source** manifest with base app metadata (id, name, description, compatibility, etc.)
2. **`widgets/<id>/widget.compose.json`** — Individual widget definitions
3. **Root `app.json`** — The **generated** output, merged from the above files

> **IMPORTANT**: Both `.homeycompose/app.json` AND root `app.json` must exist. The CLI reads `.homeycompose/app.json` as the source and writes the merged result (with widgets, drivers, etc.) to root `app.json`. Deleting root `app.json` causes errors.

> **WARNING**: If `.homeycompose/app.json` is missing but root `app.json` exists, the CLI shows:
> `Warning: Could not find a Homey Compose app.json manifest!`
> Always create `.homeycompose/app.json` with the base metadata.

### Creating a Compose app

```
my-app/
├── .homeycompose/
│   └── app.json          # Source manifest (base metadata only, no widgets)
├── app.json              # Generated (copy of .homeycompose/app.json + merged widgets)
├── app.js                # App entry point
├── package.json
├── widgets/
│   └── my-widget/
│       ├── widget.compose.json
│       └── public/
│           └── index.html
└── locales/
    └── en.json
```

### .homeycompose/app.json example

```json
{
  "id": "com.example.myapp",
  "version": "1.0.0",
  "compatibility": ">=12.3.0",
  "sdk": 3,
  "platforms": ["local"],
  "name": { "en": "My App" },
  "description": { "en": "App description" },
  "category": ["tools"],
  "brandColor": "#00B8FF",
  "permissions": [],
  "images": {
    "small": "/assets/images/small.png",
    "large": "/assets/images/large.png",
    "xlarge": "/assets/images/xlarge.png"
  },
  "author": { "name": "Your Name", "email": "you@example.com" }
}
```

**Key rules:**
- Widget apps require `"compatibility": ">=12.3.0"` (widgets need SDK 12.3+)
- Widget apps must use `"platforms": ["local"]` (widgets are not available on Homey Cloud)
- Do NOT include `"widgets"` in `.homeycompose/app.json` — they are auto-merged from `widget.compose.json` files

---

## Translations (Locales)

Homey uses per-language JSON files in `locales/` for runtime translations.

### File structure

```
locales/
├── en.json    # English (required)
└── nl.json    # Dutch (or any other language)
```

### Format rules

- Each file contains translations for **one language** — the filename IS the language
- Do NOT nest under a language key (wrong: `{"en": {"title": "..."}}`)
- Widget translations go under `widgets.<widgetId>.<key>`

```json
{
  "widgets": {
    "my-widget": {
      "loading": "Loading...",
      "error": "Something went wrong"
    }
  }
}
```

### Usage in widgets

```javascript
// Direct call
const text = Homey.__('widgets.my-widget.loading');

// Helper pattern (recommended)
const __ = (key) => Homey.__(`widgets.my-widget.${key}`) ?? key;
const text = __('loading');
```

> **IMPORTANT**: If a translation key is missing, `Homey.__()` returns the key path as a string. Always populate both `en.json` and `nl.json` with all keys used in widget code.

---

## Common Patterns

### Dynamic Height Based on Content

```javascript
function updateHeight() {
  const height = document.body.scrollHeight;
  Homey.setHeight(height);
}

// Call after content changes
updateHeight();
```

### Refresh Data Periodically

```javascript
async function refresh() {
  const data = await Homey.api('GET', '/');
  renderData(data);
}

// Initial load
refresh();

// Refresh every 5 minutes
setInterval(refresh, 5 * 60 * 1000);
```

### Listen for Setting Changes

```javascript
Homey.on('settings.set', (key, value) => {
  settings[key] = value;
  renderWidget();
});
```

---

## File Structure for Monorepo

When building multiple Homey apps in a monorepo:

```
my-monorepo/
├── apps/
│   ├── com.example.app-one/
│   │   ├── .homeycompose/
│   │   │   └── app.json       # Source manifest
│   │   ├── app.json            # Generated manifest
│   │   ├── app.js
│   │   ├── package.json
│   │   └── widgets/
│   │       └── my-widget/
│   └── com.example.app-two/
│       └── ...
├── pnpm-workspace.yaml
└── turbo.json
```

Each Homey app is a standalone package that can be developed and published independently.

### Turbo Integration

Add these scripts to each app's `package.json`:

```json
{
  "scripts": {
    "homey:run": "echo 'Only one app can run in dev mode at a time. Run directly: homey app run'",
    "homey:install": "homey app install",
    "homey:build": "homey app build",
    "homey:publish": "homey app publish"
  }
}
```

Add matching tasks to `turbo.json`:

```json
{
  "tasks": {
    "homey:run": { "cache": false, "persistent": true },
    "homey:install": { "cache": false },
    "homey:build": {},
    "homey:publish": { "cache": false }
  }
}
```

Usage:
```bash
turbo run homey:install   # Install all apps to Homey
turbo run homey:build     # Build all apps
turbo run homey:publish   # Publish all apps
```

> **WARNING**: `homey app run` (dev mode) uses port 9229 for debugging.
> Only ONE app can run in dev mode at a time. Running multiple apps
> simultaneously causes a port conflict. Use `homey:install` to deploy
> all apps, and `homey app run` directly for single-app debugging.

---
name: widgetbox
description: |
  WidgetBox-specific patterns and standards for building Homey dashboard widgets.
  Covers settings conventions, height strategies, init patterns, shared CSS,
  and code structure used across all WidgetBox apps.

  Use when: creating new widgets, modifying existing widgets, adding settings,
  handling height/sizing, styling with shared CSS, or standardizing code patterns.
---

# WidgetBox Widget Development Skill

Standards and patterns for all WidgetBox Homey dashboard widgets. This skill extends the `homey` skill with project-specific conventions.

> **Prerequisites**: Read the `homey` skill first for general Homey widget development.

## Apps Overview

| App | ID | Widgets |
|-----|----|---------|
| Clocks | `com.nielsvanbrakel.widgetbox-clocks` | analog-clock, digital-clock, binary-clock, flip-clock, date, word-clock-grid, word-clock-sentence |
| Buienradar | `com.nielsvanbrakel.widgetbox-buienradar` | buienradar, buienradar-map, buientabel |
| Windy | `com.nielsvanbrakel.widgetbox-windy` | windy |
| Utilities | `com.nielsvanbrakel.widgetbox-utilities` | stopwatch, timer |
| Layout | `com.nielsvanbrakel.widgetbox-layout` | spacer |
| YouTube | `com.nielsvanbrakel.widgetbox-youtube` | youtube |

---

## Publishing & Versioning

### Workflow

We use **Turbo** to publish all apps interactively.

1. **Ensure Versions Match**: All apps should share the same version number (e.g. `0.1.0`) across `package.json`, `app.json`, and `.homeycompose/app.json`.
2. **Run Publish Command**:
   ```bash
   turbo run homey:publish --concurrency 1
   ```
   - **`--concurrency 1`** is required to run the interactive prompts sequentially.
   - **`interactive: true`** is set in `turbo.json` to enable TTY.

3. **Handle Prompts**:
   - The CLI will ask: `? Do you want to update your app's version number?`
   - Answer **No** if you have already set the version in the files (recommended).
   - Answer **Yes** to let the CLI bump the version (verifying it updates all files correctly).

### Asset Standards

To pass validation (`homey app validate --level publish`), every app MUST have:

- `assets/images/small.png` (250x175)
- `assets/images/large.png` (500x350)
- `assets/icon.svg` (Source for icons)

**Generation**: Use the `icon.svg` to generate the PNGs if missing.
```bash
sips -s format png icon.svg --out small.png
sips -Z 96 small.png # Or standard app icon size
# Resize mainly for store assets:
sips -z 175 250 small.png
sips -z 350 500 large.png
```

---

## Standard Settings

### Size Setting

Most widgets support a `size` dropdown with these standard values:

```json
{
  "id": "size",
  "type": "dropdown",
  "label": { "en": "Size", "nl": "Grootte" },
  "value": "medium",
  "values": [
    { "id": "xsmall", "label": { "en": "Extra Small", "nl": "Extra Klein" } },
    { "id": "small", "label": { "en": "Small", "nl": "Klein" } },
    { "id": "medium", "label": { "en": "Medium", "nl": "Gemiddeld" } },
    { "id": "large", "label": { "en": "Large", "nl": "Groot" } },
    { "id": "xlarge", "label": { "en": "Extra Large", "nl": "Extra Groot" } }
  ]
}
```

**Used by:** All clock widgets, date widget.

### Color Setting

Color dropdowns use Homey's built-in color palette:

```json
{
  "id": "color",
  "type": "dropdown",
  "label": { "en": "Color", "nl": "Kleur" },
  "value": "default",
  "values": [
    { "id": "default", "label": { "en": "Default", "nl": "Standaard" } },
    { "id": "blue", "label": { "en": "Blue", "nl": "Blauw" } },
    { "id": "green", "label": { "en": "Green", "nl": "Groen" } },
    { "id": "orange", "label": { "en": "Orange", "nl": "Oranje" } },
    { "id": "red", "label": { "en": "Red", "nl": "Rood" } },
    { "id": "purple", "label": { "en": "Purple", "nl": "Paars" } }
  ]
}
```

Map `"default"` to `var(--homey-text-color)` and named colors to `var(--homey-color-{name}-500)`.

### Horizontal Alignment

```json
{
  "id": "horizontalAlignment",
  "type": "dropdown",
  "label": { "en": "Horizontal Alignment", "nl": "Horizontale Uitlijning" },
  "value": "center",
  "values": [
    { "id": "left", "label": { "en": "Left", "nl": "Links" } },
    { "id": "center", "label": { "en": "Center", "nl": "Midden" } },
    { "id": "right", "label": { "en": "Right", "nl": "Rechts" } }
  ]
}
```

### Clock Format

```json
{
  "id": "clockFormat",
  "type": "dropdown",
  "label": { "en": "Time Format", "nl": "Tijdformaat" },
  "value": "24",
  "values": [
    { "id": "24", "label": { "en": "24-hour", "nl": "24-uur" } },
    { "id": "12", "label": { "en": "12-hour", "nl": "12-uur" } }
  ]
}
```

### Aspect Ratio (for iframe/embed widgets)

```json
{
  "id": "aspectRatio",
  "type": "dropdown",
  "label": { "en": "Aspect Ratio", "nl": "Beeldverhouding" },
  "value": "16:9",
  "values": [
    { "id": "1:1", "label": { "en": "Square (1:1)" } },
    { "id": "4:3", "label": { "en": "4:3" } },
    { "id": "16:9", "label": { "en": "16:9 (Default)" } },
    { "id": "9:16", "label": { "en": "Portrait (9:16)" } },
    { "id": "21:9", "label": { "en": "Ultrawide (21:9)" } },
    { "id": "3:1", "label": { "en": "Panoramic (3:1)" } }
  ]
}
```

### Setting Hints

Use the `hint` property to add explanation text to settings that may not be immediately clear to the user. Always provide bilingual hints (en + nl). Use hints for:
- Text/number inputs where the expected format isn't obvious (e.g. coordinates, IDs)
- Settings whose effect is non-trivial or could be confusing
- Settings that interact with other settings

```json
{
  "id": "lat",
  "type": "text",
  "label": { "en": "Latitude", "nl": "Breedtegraad" },
  "hint": {
    "en": "Enter the latitude of your location (e.g. 52.1326)",
    "nl": "Voer de breedtegraad van je locatie in (bijv. 52.1326)"
  },
  "value": "52.1326"
}
```

> **Rule**: Always add a `hint` to `text` and `number` settings. For `dropdown` and `checkbox` settings, only add a hint if the label alone doesn't sufficiently explain what the setting does.

---

## Height Strategies

Widgets use one of three height patterns:

### 1. Content-Based Height (Clock Widgets)

Calculates height from DOM content. Used by all clock and date widgets.

```javascript
function calculateTotalHeight() {
  const widget = document.getElementById('widget');
  return widget ? widget.offsetHeight : 128;
}

Homey.ready({ height: calculateTotalHeight() });
new ResizeObserver(() => Homey.setHeight?.(calculateTotalHeight())).observe(document.body);
```

### 2. Aspect Ratio Height (Embed Widgets)

Calculates height as a percentage for iframe-based widgets. Used by youtube, windy, buientabel.

```javascript
function getAspectRatioPercentage(aspectRatio) {
  const ratios = {
    '1:1': '100%',
    '4:3': '75%',
    '16:9': '56.25%',
    '9:16': '177.78%',
    '21:9': '42.86%',
    '3:1': '33.33%'
  };
  return ratios[aspectRatio] || '56.25%';
}

Homey.ready({ height: getAspectRatioPercentage(settings.aspectRatio || '16:9') });
```

### 3. Fixed/Calculated Height (Utility Widgets)

Calculates from component count. Used by stopwatch, timer.

```javascript
const calcHeight = () => {
  const itemCount = items.length;
  const itemHeight = 60;
  const headerHeight = 40;
  return headerHeight + (itemCount * itemHeight) + padding;
};

Homey.ready({ height: calcHeight() });
```

---

## Init Pattern

All widgets follow this initialization flow:

```javascript
let currentSettings = {};

function onHomeyReady(Homey) {
  currentSettings = Homey.getSettings() || {};
  renderWidget();

  Homey.on('settings.set', (key, value) => {
    currentSettings[key] = value;
    renderWidget();
    Homey.setHeight?.(calculateTotalHeight());
  });

  // Start intervals (clocks: 1000ms, data: configurable)
  Homey.ready({ height: calculateTotalHeight() });
}
```

> **Variant**: Stopwatch/timer use `window.onHomeyReady = async (homey) => {}`, others use `function onHomeyReady(Homey) {}`. Both work.

---

## Shared CSS

Clock and utility widgets import shared styles:

```html
<link rel="stylesheet" href="../../_shared/shared-styles.css">
```

Located at `widgets/_shared/shared-styles.css`, providing:

| Class | Purpose |
|-------|---------|
| `.widget-container` | Flex column, centered, standard padding |
| `.widget-container--compact` | Reduced padding variant |
| `.widget-row` / `.widget-column` | Flex row/column layouts |
| `.widget-center` | Centered flex container |
| `.widget-button` | Standard button with hover/active states |
| `.widget-button--primary` | Blue primary button |
| `.widget-button--small` | Compact button |
| `.widget-text-display` | Large bold text (numbers) |
| `.widget-text-title` | Medium bold text |
| `.widget-text-body` | Default body text |
| `.widget-text-secondary` | Secondary/muted text |
| `.widget-text-small` | Small caption text |
| `.widget-text-mono` | Monospace font |
| `.widget-loading` | Loading spinner |
| `.widget-error` | Error message |
| `.widget-empty` | Empty state |
| `.widget-card` | Card background with shadow |
| `.widget-fade-in` | Fade-in animation |
| `.widget-pulse` | Pulse animation |
| `.widget-sr-only` | Screen reader only |

Always use `var(--homey-*)` variables for colors, fonts, and spacing.

---

## Widget Transparency

| Widget Type | `transparent` | Rationale |
|------------|--------------|-----------|
| Clock widgets | `false` | Card background for readability |
| Stopwatch, Timer | `false` | Card background for readability |
| Spacer | `true` | Invisible spacing element, blends with dashboard |
| Embed widgets (buienradar, windy, youtube) | not set | Iframe handles its own background |

---

## Color Mapping Pattern

Map color setting IDs to CSS variables:

```javascript
function getColor(colorId) {
  if (colorId === 'default') return 'var(--homey-text-color)';
  if (colorId === 'white') return '#fff';
  if (colorId === 'black') return '#000';
  return `var(--homey-color-${colorId}-500)`;
}
```

---

## Translations

All runtime text in widgets must use `Homey.__()` with keys defined in `locales/en.json` and `locales/nl.json`.

### Translation key structure

Keys live under `widgets.<widgetId>.<key>`:

```json
{
  "widgets": {
    "buientabel": {
      "loading": "Loading...",
      "noRain": "No rain expected",
      "error": "Something went wrong"
    },
    "stopwatch": {
      "addStopwatch": "Add Stopwatch",
      "lap": "Lap"
    }
  }
}
```

### Helper pattern

```javascript
const __ = (key) => Homey.__(`widgets.my-widget.${key}`) ?? key;
```

### Rules

- **Never hardcode user-facing text** — always use translation calls
- **Both `en.json` and `nl.json` are required** in every app's `locales/` directory
- Each locale file contains translations for one language only (filename = language)
- Widgets without runtime text still need empty widget entries in locale files

---

## Documentation Maintenance

### When to update

| Trigger | What to update |
|---------|----------------|
| New widget added | App's `README.txt`, monorepo `README.md` apps table, this skill's Apps Overview table |
| Widget removed | App's `README.txt`, monorepo `README.md` apps table, this skill's Apps Overview table |
| Major feature change to a widget | App's `README.txt` (update feature description) |
| New app added to monorepo | New `README.txt`, monorepo `README.md`, this skill's Apps Overview table |
| App removed from monorepo | Remove `README.txt`, update monorepo `README.md`, this skill's Apps Overview table |

### README.txt format rules

- **Plain text only** — no markdown, no URLs, no changelogs
- **No app name** in the text — it already appears above the README on the store page
- **Describe possibilities** — write a friendly story, not a technical spec
- Every `README.txt` starts with the **shared WidgetBox intro paragraph** (see below)

### Shared intro paragraph

Every app's `README.txt` must start with this exact paragraph:

```
WidgetBox adds clean, native-looking widgets to your Homey dashboard. Designed to fit perfectly with Homey's style, these widgets help you customize your dashboard just the way you like it.
```

After the intro, add a blank line and then the app-specific description.

### Description one-liners

The `description` field in `.homeycompose/app.json` is a catchy tagline shown below the app name on the store. Rules:
- Be specific about what the app does (avoid generic "adds support for X")
- Keep it short — one sentence
- Always provide both `en` and `nl` translations

---

### Writing Guidelines

- **Tone**: Friendly, functional, and humble. Avoid salesy or hyperbolic words like "premium", "stunning", "ultimate", "perfectly".
- **Generic Counts**: Use terms like "multiple", "various", or "collection of" instead of specific numbers (e.g., "7 widgets", "6 styles"). This ensures descriptions remain accurate as features are added or removed.
- **Shared Intro**: Always use the standard intro paragraph defined above.

---

## New Widget Checklist

When creating a new WidgetBox widget:

1. **Directory structure**: `widgets/<id>/widget.compose.json` + `public/index.html`
2. **Import shared CSS** if using standard components: `../../_shared/shared-styles.css`
3. **Use standard settings** from this document (size, color, alignment, etc.)
4. **Include bilingual labels** (en + nl) for all settings
5. **Add `hint`** to all `text` and `number` settings (bilingual)
6. **Add translations** to `locales/en.json` and `locales/nl.json` for all runtime text
7. **Choose height strategy**: content-based, aspect-ratio, or fixed
8. **Follow init pattern**: getSettings → render → listen for changes → ready
9. **Set `transparent`** based on widget type (see table above)
10. **Add `ResizeObserver`** if height depends on content
11. **Use Homey CSS variables** for all colors, fonts, spacing
12. **Add preview images**: `preview-dark.png` and `preview-light.png` (1024x1024)
13. **Update documentation**: update the app's `README.txt`, monorepo `README.md`, and this skill's Apps Overview table

---

## Sandbox Architecture

The sandbox app (`apps/sandbox/`) is a Vite/React application for previewing and testing widgets locally with e2e tests via Playwright.

### File Structure

```
apps/sandbox/
├── scripts/
│   └── generate-registry.js    # Scans widget.compose.json files, outputs src/registry.json
├── src/
│   ├── components/
│   │   ├── Icons.jsx            # SVG icon components
│   │   ├── Sidebar.jsx          # Widget list grouped by app
│   │   ├── Toolbar.jsx          # Theme toggle, width presets, reload
│   │   ├── WidgetPreview.jsx    # Iframe preview with Homey card framing
│   │   └── SettingsPanel.jsx    # Settings controls + debug scenarios
│   ├── lib/
│   │   ├── MockHomey.js         # Mock Homey API (settings, height, translations, events)
│   │   ├── homeyStyles.js       # Injects Homey CSS variables into iframe
│   │   ├── scenarios.js         # Debug scenario definitions per widget
│   │   └── mocks/
│   │       └── buienradarMocks.js  # Buienradar-specific mock data + real fetch
│   ├── App.jsx                  # Root component (state + composition only)
│   ├── index.css                # All styles (no inline styles in components)
│   ├── main.jsx                 # React entry point
│   └── registry.json            # Generated (gitignored), do NOT commit
├── index.html
├── package.json
└── vite.config.js
```

### Adding Widget-Specific Mocks

To add mock data for a new widget:

1. Create `src/lib/mocks/<widgetName>Mocks.js` with a handler function
2. Import and call from `MockHomey.api()` method
3. Add debug scenarios in `src/lib/scenarios.js`

### Code Quality Rules

- **No inline styles** in JSX — use CSS classes in `index.css`
- **No icon SVGs** in component files — add to `Icons.jsx`
- **No widget-specific logic** in `MockHomey.js` — delegate to `mocks/` modules
- `registry.json` is **generated** — never edit manually, never commit
- The sandbox uses **Biome** for linting (no ESLint)

---

## E2E Testing

All widgets are tested via Playwright e2e tests against the sandbox.

### Structure

```
tests/
├── e2e/           # Test specs per app/feature
│   ├── widgets.spec.ts          # Sandbox loading tests
│   ├── clocks.spec.ts
│   ├── utilities.spec.ts
│   ├── windy.spec.ts
│   ├── youtube.spec.ts
│   ├── buienradar.spec.ts
│   ├── layout.spec.ts
│   └── sandbox-translations.spec.ts
├── pages/         # Page Object Model
│   ├── SandboxPage.ts           # Base page (goto, selectWidget, settings helpers)
│   ├── ClocksPage.ts
│   ├── UtilitiesPage.ts
│   ├── WindyPage.ts
│   ├── YouTubePage.ts
│   ├── BuienradarPage.ts
│   └── LayoutPage.ts
```

### Running Tests

```bash
# Run all tests
pnpm test:e2e

# Run specific test file
npx playwright test tests/e2e/clocks.spec.ts
```

### Writing Tests

1. **Extend `SandboxPage`** for widget-specific page objects
2. **Use getters** for element selectors (e.g. `get flipClock()`)
3. **Use `SandboxPage` helpers** for common interactions:
   - `selectWidget(name)` — clicks widget in sidebar
   - `setSettingCheckbox(label, checked)` — toggles checkbox setting
   - `setSettingSelect(label, option)` — selects dropdown option
   - `setSettingInput(label, value)` — fills text/number input
4. **Import only what you need** from `@playwright/test` (avoid unused imports)