# NEXUS Standalone Separation

This directory is the separated NEXUS application baseline.

## Source Boundary

- Do not edit the original groupware repository directly for NEXUS work.
- Original groupware path: `C:\Users\KIMSEONIL\Desktop\바이브코딩\worklog`
- NEXUS standalone path: `C:\Users\KIMSEONIL\Documents\Codex\2026-06-12\zeta-worktalk-1-1-30-pdf\nexus-standalone`

## Current State

- Frontend/runtime is separated into this project directory.
- The app still temporarily uses the existing Supabase `worklog` project until a dedicated NEXUS Supabase project is created.
- NEXUS-specific DB objects should stay under `worktalk_*`, `nexus_*`, and approval document tables used by NEXUS.

## Deployment Direction

1. Create a new GitHub repository for NEXUS.
2. Push this directory as the initial NEXUS source.
3. Create a new Vercel project connected to the NEXUS repository.
4. Point the desktop client installer to the new NEXUS Vercel URL.
5. Later, migrate from the shared Supabase project to a dedicated NEXUS Supabase project if required.

## Rule

NEXUS is not the groupware chat menu. It is a separate messenger, document, approval, and worklog application.
