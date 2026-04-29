# Archived scripts

Files in this directory are retained for reference but are **not** part of
the active runtime. Nothing here is loaded, scheduled, or invoked by any
deployed code path — they're kept around in case the underlying mechanism
is ever revived.

## Reactivating something

The exact steps depend on what the file is, but the general shape:

1. Move the file back out of `archive/` into the appropriate live location
   (usually `scripts/` for shell scripts and launchd plists).
2. Re-wire whatever invokes it. For macOS launchd `.plist` agents that
   means installing into `~/Library/LaunchAgents/` and loading with
   `launchctl load`. For shell scripts called by other parts of the
   project, restore the caller too.
3. Verify it actually runs and produces the expected side effect before
   committing the resurrection.

## Current contents

- **`today.positron.positronitron.plist`** — a macOS launchd agent that
  used to fire the Positronitron auto-run pipeline locally. Superseded
  by the production scheduling path (Synology NAS cron hitting
  `https://admin.positron.today/api/positronitron`); kept here in case
  a future contributor wants to run Positronitron auto-runs from a
  local machine again.
