#!/usr/bin/env python3
"""Git passthrough with a cached index for T3 Code's checkpoint capture."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

GIT = '/usr/bin/git'
args = sys.argv[1:]
prefix = args[:2] if len(args) >= 2 and args[0] == '-C' else []
command = args[len(prefix):]
git = [GIT, *prefix]
target = Path(os.environ.get('GIT_INDEX_FILE', ''))
if prefix and not target.is_absolute():
    target = Path(prefix[1]) / target
if command == ['read-tree', 'HEAD'] and re.fullmatch(r't3-checkpoint-index-[0-9a-f-]{36}', target.name):
    env = {key: value for key, value in os.environ.items() if key != 'GIT_INDEX_FILE'}
    paths = subprocess.check_output([
        *git, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--git-path', 'index',
    ], env=env, text=True).splitlines()
    if len(paths) == 2 and target.parent.resolve() == Path(paths[0]).resolve() and Path(paths[1]).is_file() and not target.exists():
        # Reset to HEAD while retaining stat data for unchanged tracked assets.
        with open(paths[1], 'rb') as source, target.open('xb') as destination:
            shutil.copyfileobj(source, destination)
        subprocess.run([*git, 'read-tree', '--reset', 'HEAD'], check=True)
        files = subprocess.check_output([*git, 'ls-files', '-z'])
        for flag in ['--no-assume-unchanged', '--no-skip-worktree']:
            subprocess.run([*git, 'update-index', flag, '-z', '--stdin'], input=files, check=True)
        sys.exit(0)
os.execv(GIT, [GIT, *args])
