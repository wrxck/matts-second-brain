#!/usr/bin/env python3
# session-start hook for matts-second-brain. emits the brain discipline directive
# unless the plugin's sessionReminder userConfig is set to false. kept dependency-free
# and fail-open-silent: any error just produces no output rather than breaking startup.
import json
import os
import sys


def reminder_enabled():
    # default on. only an explicit false in the plugin's userConfig disables it.
    cfg_path = os.path.expanduser("~/.claude.json")
    try:
        with open(cfg_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return True
    plugin_configs = data.get("pluginConfigs", {})
    for key, val in plugin_configs.items():
        if key.startswith("matts-second-brain@") or key == "matts-second-brain":
            opts = (val or {}).get("options", {})
            if "sessionReminder" in opts:
                return bool(opts["sessionReminder"])
    return True


def main():
    if not reminder_enabled():
        return
    root = os.environ.get("CLAUDE_PLUGIN_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    doc = os.path.join(root, "hooks", "discipline-reminder.md")
    try:
        with open(doc, "r", encoding="utf-8") as fh:
            sys.stdout.write(fh.read())
    except Exception:
        # nothing to inject if the doc is missing; stay silent.
        pass


if __name__ == "__main__":
    main()
