#!/bin/bash
# usage: dl.sh outdir id...
cd "$1"; shift
for id in "$@"; do
  [ -f $id.mp4 ] || curl -sS -A 'Mozilla/5.0' -o $id.mp4 https://videos.pexels.com/video-files/$id/$id-sd_960_540_25fps.mp4 || echo fail $id
  [ -s $id.mp4 ] && ffmpeg -loglevel error -y -ss 2 -i $id.mp4 -frames:v 1 -vf "scale=480:270,drawtext=text=$id:fontcolor=yellow:fontsize=28:x=8:y=8" $id.png
done
ls -la
