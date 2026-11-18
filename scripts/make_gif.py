"""Builds docs/race.gif from the frames scripts/shots.ts captured.

Needs Pillow. Run through `npm run shots`, or on its own after it.
"""
import json
from pathlib import Path

from PIL import Image

FRAMES = Path("node_modules/.cache/shots")
WIDTH = 520
# Frames closer together than this are dropped to keep the file small.
MIN_GAP_MS = 95

meta = json.loads((FRAMES / "frames.json").read_text())
shots = []
for shot in meta["frames"]:
    if not shots or shot["at"] - shots[-1]["at"] >= MIN_GAP_MS:
        shots.append(shot)
images, durations = [], []
for i, shot in enumerate(shots):
    until = shots[i + 1]["at"] if i + 1 < len(shots) else meta["end"]
    frame = Image.open(FRAMES / shot["file"]).convert("RGB")
    frame = frame.resize((WIDTH, round(frame.height * WIDTH / frame.width)), Image.LANCZOS)
    images.append(frame.quantize(colors=72, method=Image.Quantize.MEDIANCUT, kmeans=2, dither=Image.Dither.NONE))
    durations.append(max(20, until - shot["at"]))
images[0].save("docs/race.gif", save_all=True, append_images=images[1:], duration=durations, loop=0, optimize=True)
print(f"docs/race.gif: {len(images)} frames, {Path('docs/race.gif').stat().st_size // 1024} KB")
