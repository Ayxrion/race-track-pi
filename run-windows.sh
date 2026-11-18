#!/bin/sh
# Run the Windows build (MSYS2's MinGW DLLs on the PATH). Saves go to ./data.
# Type the serial test commands (next, finale, shower, replay, shot...) here.
cd "$(dirname "$0")"
export PATH="/c/msys64/mingw32/bin:$PATH"
exec ./build/race_track.exe "$@"
