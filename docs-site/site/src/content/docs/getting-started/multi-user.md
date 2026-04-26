---
title: Multi-user setup
description: Share one brain across multiple OS users on a single host.
---

When several OS users (e.g. `root`, `alice`, `bob`) on the same host all run Claude Code, they probably want to share **one** brain — one Trilium instance, one set of Standards, one growing set of Decisions.

The plugin's wizard handles this if you pass `--multi-user`:

```
/matts-second-brain:install --multi-user --users alice,bob
```

What it does:

## 1. Creates a `claude` group

```bash
sudo groupadd claude
sudo usermod -aG claude root
sudo usermod -aG claude alice
sudo usermod -aG claude bob
```

Membership in this group is what grants brain access.

## 2. Stores credentials in a shared, group-readable location

```
/etc/claude-brain/
  └── trilium-token       # mode 0640, owner root:claude
```

Or for Trilium specifically with [fleet](https://fleet.hesketh.pro/) installed: store the token in fleet's encrypted vault and let `fleet-unseal.service` decrypt it at boot to `/run/fleet-secrets/claude-brain/.env`. This is the recommended pattern — same operational model as every other secret on the host.

## 3. Wraps the MCP launch

```bash
/usr/local/bin/second-brain-mcp     # wrapper that loads the shared token + execs the Node MCP
```

## 4. Auto-registers the MCP for new users

```bash
/etc/profile.d/claude-brain.sh      # idempotent: adds second-brain MCP entry to ~/.claude.json on login
```

Future users on the host get the brain auto-wired without manual setup — they just need to be added to the `claude` group.

## What stays per-user

Nothing functional. The brain is one Trilium instance with one set of credentials, accessible to anyone in the `claude` group. Per-user `~/.claude.json` files contain the same MCP entry pointing at the same wrapper.

## Verifying

```bash
# As any user in the claude group:
sudo -u alice second-brain-mcp <<<'{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

Should return the brain_* tool list. If not, check group membership and that the token file is readable by the user (`getent group claude`, `stat /etc/claude-brain/trilium-token`).
