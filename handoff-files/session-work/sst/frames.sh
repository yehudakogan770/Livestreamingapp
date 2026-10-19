#!/bin/bash
D=/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad
cd $D/sst
for f in wide close side live; do ffmpeg -loglevel error -y -ss 5 -i ../demo2/$f.webm -frames:v 1 -vf scale=320:-1 $f.png; done
ffmpeg -loglevel error -y -i wide.png -i close.png -i side.png -i live.png -filter_complex hstack=inputs=4 all.png
ls /home/user/Livestreamingapp/node_modules | wc -l
ls /home/user/Livestreamingapp/node_modules/.bin/vite
