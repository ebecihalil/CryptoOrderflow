---
name: Artifact-free root preview
description: Replit preview considerations for this project's standalone root Express app.
---

Keep this project as a root-level Node/Express application without registered artifacts.

**Why:** the user explicitly requested eliminating the artifact packages and monorepo structure.

**How to apply:** Keep the root `Start application` workflow. Do not recreate an artifact solely to satisfy artifact-specific screenshot tooling; verify the running page and API through the workflow's open port.

Preview captures can retain browser localStorage across captures and workflow restarts.

**Why:** a light-mode check remained dark after an earlier toggle test, even after the application was rebuilt and restarted. Server restarts do not reset browser preferences.

**How to apply:** explicitly establish the intended browser theme when verifying theme-specific changes. Do not change the application's normal default or authentication to obtain a screenshot; remove any temporary generated test fixtures before delivery.
