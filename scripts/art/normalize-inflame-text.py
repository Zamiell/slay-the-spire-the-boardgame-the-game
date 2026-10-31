#!/usr/bin/env python3
"""Compatibility entry point for the original Inflame rules correction."""
import runpy
import sys
from pathlib import Path


if __name__ == '__main__':
    sys.argv.extend(['--region', '180', '630', '570', '840'])
    runpy.run_path(str(Path(__file__).with_name('normalize-card-text.py')), run_name='__main__')
