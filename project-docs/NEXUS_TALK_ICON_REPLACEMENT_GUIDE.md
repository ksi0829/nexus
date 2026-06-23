# NEXUS TALK Icon Replacement Guide

This document maps every current icon/logo usage point in the NEXUS standalone app.
Use it when the final NEXUS TALK brand icon is confirmed.

## Required Source Assets

Prepare the final icon package before replacement.

- `source-app-icon-1024.png`
  - 1024x1024
  - Yellow background, dark speech bubble, white symbol
  - No internal text
- `source-maskable-icon-1024.png`
  - 1024x1024
  - Safe-area aware Android maskable icon
  - Keep the core symbol inside the central safe area
- `source-notification-icon.png`
  - Monochrome transparent PNG
  - Android notification status icons are tinted by the OS, so do not use yellow background here
  - Prefer a simple white `N` or white speech-bubble mark on transparent background
- `source-splash.png`
  - Splash/loading artwork if needed
  - Recommended: yellow background with centered symbol

## Current Icon Files

Replace or regenerate these files from the final source assets.

### Browser / Favicon

- `app/favicon.ico`
- `public/favicon-16x16.png`
- `public/favicon-32x32.png`
- `app/icon.png`
- `public/nexus.ico`

### PWA / Mobile Install Icons

- `public/nexus-talk-icon-192.png`
- `public/nexus-talk-icon-512.png`
- `public/maskable-icon.png`
- `app/apple-icon.png`

Optional additional sizes currently present:

- `public/nexus-talk-icon-16.png`
- `public/nexus-talk-icon-32.png`
- `public/nexus-talk-icon-48.png`
- `public/nexus-talk-icon-64.png`
- `public/nexus-talk-icon-180.png`
- `public/nexus-talk-icon-256.png`
- `public/nexus-talk-icon-1024.png`

### Push Notification Icons

- `public/notification-icon.png`
- `public/notification-badge.png`
- `public/notification-icon-maskable.png`

Important:

- Android notification icons should be monochrome and transparent.
- The yellow app icon should not be used directly as the status-bar notification icon.

### Splash / Brand Symbol

- `public/nexus-talk-splash.png`
- `public/nexus-symbol.png`

### Older / Legacy Icon Files

These are still present in `public`. Do not use them for new branding unless a code reference is intentionally restored.

- `public/nexus-icon-192.png`
- `public/nexus-icon-512.png`
- `public/nexus-icon-source.png`
- `public/nexus-icon-v2-192.png`
- `public/nexus-icon-v2-512.png`
- `public/worktalk-icon-192.png`
- `public/worktalk-icon-512.png`
- `public/brand/zeta-app-icon.png`
- `public/brand/zeta-logo.png`
- `public/brand/zeta-wordmark.png`

## Manifest / Metadata References

### `app/manifest.ts`

Current icon references:

- `/nexus-talk-icon-192.png?v=5`
- `/nexus-talk-icon-512.png?v=5`
- `/maskable-icon.png?v=5`

Also confirms:

- `name: "NEXUS TALK"`
- `short_name: "NEXUS TALK"`
- `background_color: "#FFD400"`
- `theme_color: "#FFD400"`
- `orientation: "portrait"`

When replacing icons:

1. Keep the same filenames if possible.
2. Increase the query version, e.g. `?v=5`, to break browser/PWA cache.
3. Confirm maskable icon uses `purpose: "maskable"`.

### `app/layout.tsx`

Current favicon / Apple icon references:

- `/favicon-16x16.png?v=5`
- `/favicon-32x32.png?v=5`
- `/icon.png?v=5`
- `/favicon.ico?v=5`
- `/apple-icon.png?v=5`

When replacing icons:

1. Keep file names stable.
2. Increase all matching query versions together.

## Service Worker / Push References

### `public/worktalk-sw.js`

Current notification references:

- `/notification-icon.png?v=5`
- `/notification-badge.png?v=5`

When replacing push icons:

1. Replace `public/notification-icon.png`.
2. Replace `public/notification-badge.png`.
3. Increase query version in `public/worktalk-sw.js`.
4. Reinstall or refresh PWA during testing because service worker and notification icons may be cached.

## App UI Logo References

Current active logo references:

- `components/nexus/NexusNavigation.tsx`
  - `/nexus-talk-icon-192.png?v=5`
- `components/worktalk/WorkTalkApp.tsx`
  - `/nexus-talk-icon-192.png?v=5`
  - `/notification-icon.png?v=5`
  - `/notification-badge.png?v=5`
- `app/login/page.tsx`
  - `/nexus-talk-icon-512.png?v=5`
- `app/_components/BrandLogo.tsx`
  - `/nexus-talk-icon-192.png?v=5`

When replacing app icons:

1. Replace the PNG assets first.
2. Increase `?v=` values in all references.
3. Check login screen, left navigation, WorkTalk rail, and installed PWA icon.

## Replacement Procedure

1. Place final design source files in a temporary local folder.
2. Generate the required output sizes:
   - 16, 32, 48, 64, 180, 192, 256, 512, 1024 PNG
   - ICO for favicon if needed
   - maskable 512 PNG
   - monochrome notification icon and badge
3. Replace files under:
   - `app/`
   - `public/`
4. Update cache-busting query strings:
   - `app/layout.tsx`
   - `app/manifest.ts`
   - `app/login/page.tsx`
   - `app/_components/BrandLogo.tsx`
   - `components/nexus/NexusNavigation.tsx`
   - `components/worktalk/WorkTalkApp.tsx`
   - `public/worktalk-sw.js`
5. Run:
   - `npm run lint`
   - `npm run build`
6. Test browser favicon:
   - Chrome normal tab
   - Hard refresh
   - Incognito if cache is stubborn
7. Test PWA install icon:
   - Remove existing installed PWA/app shortcut
   - Clear site data if needed
   - Reinstall PWA
8. Test Android notification icon:
   - Send message while app is backgrounded
   - Confirm notification icon shape is correct in status bar and notification shade
9. Test app UI:
   - Login screen
   - WorkTalk left rail
   - Nexus documents navigation
10. Commit and push after visual confirmation.

## Cache Notes

Browser/PWA icons are aggressively cached.

Use all of these when testing a final icon replacement:

- Increase `?v=` cache query values.
- Redeploy production.
- In Chrome Android, remove the installed PWA and reinstall.
- Clear site storage if old icons remain.
- Service worker may keep old notification icon until updated and activated.

## Current Cache Version

Previous active icon references used:

- `?v=4`

Current icon replacement uses:

- `?v=5`
