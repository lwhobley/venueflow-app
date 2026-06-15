"""Generate zeroed App Store screenshots.

Kept for the original script name; delegates to the current zero-data
generator so App Store screenshots do not contain mock venue activity.
"""
import runpy
from pathlib import Path

runpy.run_path(str(Path(__file__).with_name("make-zeroed-appstore-screenshots.py")), run_name="__main__")
