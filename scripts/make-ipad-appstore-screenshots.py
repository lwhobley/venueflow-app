"""Generate zeroed iPad App Store screenshots.

Kept for convenience; delegates to the current zero-data generator, which
creates both iPhone and iPad screenshot sets.
"""
import runpy
from pathlib import Path

runpy.run_path(str(Path(__file__).with_name("make-zeroed-appstore-screenshots.py")), run_name="__main__")
