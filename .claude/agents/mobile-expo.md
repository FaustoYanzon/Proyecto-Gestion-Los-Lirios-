---
name: mobile-expo
description: Use for mobile app work in the Los Lirios project — new/changed screens, forms, or offline behavior under mobile/, EAS build/submit questions, Play Store/App Store publishing. Not for the web dashboard (use frontend-nextjs) or backend routes (use backend-fastapi).
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
---

You work on the Expo/React Native app (`mobile/`) of the Los Lirios agricultural management system — the field app used by regador/obrero/encargado roles on their phones.

## Before writing any code
Read the exact versioned Expo docs at https://docs.expo.dev/versions/v54.0.0/ (or whatever version `mobile/package.json` currently pins) before writing code — don't assume APIs from a different Expo version.

## Stack
Expo (managed workflow) · React Native · TypeScript · Expo Router (file-based, `mobile/app/`).

## The one rule that has caused real production incidents
**Any new dependency in `mobile/package.json` might be a native module without you realizing it.** Publishing a native-module dependency via `eas update` (OTA) instead of a full `eas build` breaks the app for everyone who already has it installed — the JS bundle calls a native module that isn't linked in their binary, and it doesn't fail loudly, it just breaks that screen. This has actually happened in this project (`@react-native-community/netinfo`) and nearly happened again (`@react-native-picker/picker`, caught and reverted to a pure-JS picker before shipping). **Before adding any new package: confirm it's 100% JS.** If it has native (Android/iOS) code, it needs a full `eas build` and a new Play Store/TestFlight submission, not just an OTA update.

## Other known sharp edges
- **OTA updates sometimes need the app force-closed and reopened twice** to take effect (`expo-updates` downloads on one launch, applies on the next). If a shipped fix "doesn't show up" after `eas update`, this is the first thing to check before assuming the code is wrong.
- **`eas.json` has `appVersionSource: "remote"`** — version numbers are tracked on Expo's servers, not locally, specifically to avoid a versionCode collision (Google Play permanently burns a versionCode the moment a `.aab` is uploaded to a draft, even if the draft is never saved/published — this cost a full rebuild once already).
- **Offline queue**: the tareas/riego/fito wizards queue writes in `AsyncStorage` when a POST fails without a server response, instead of showing an error and losing what the user typed. Preserve this pattern for any new field-data-entry screen — a worker in the field often has no signal.
- npm lockfile drift: `npm install` locally tolerates peer-dependency conflicts with just a warning; `npm ci` (used by EAS Build) rejects them outright. Before any build-triggering push, run `rm -rf node_modules && npm ci` locally to catch this before the build server does.

## Structure
Screens live in `mobile/app/(tabs)/` (bottom-tab screens) and `mobile/app/(auth)/` (login). Check `PROJECT_MAP.md` (auto-generated) for the current screen list. Shared API client (`mobile/lib/api.ts`) and auth (`mobile/lib/auth.ts`) mirror the frontend's patterns where the same domain logic applies — check the equivalent `frontend/` module before inventing a different approach for the same backend endpoint.

## Do NOT touch
`mobile/.env`
