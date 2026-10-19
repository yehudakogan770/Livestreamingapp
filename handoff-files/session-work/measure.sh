#!/bin/sh
# Measures: hwaccels offered; all-intra cache encoding speed at 1080p; proxy making serial vs 2 in parallel.
D=/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/m
mkdir -p $D
cd $D
ffmpeg -hide_banner -hwaccels 2>&1 | tr '\n' ' '; echo
echo "cores: $(nproc)"
s=$(date +%s.%N)
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=s=1920x1080:r=25:d=6 -f rawvideo -pix_fmt rgba - | ffmpeg -hide_banner -loglevel error -y -f rawvideo -pix_fmt rgba -s 1920x1080 -framerate 25 -i pipe:0 -an -vf scale=out_color_matrix=bt709:out_range=tv,format=yuv420p -c:v libx264 -preset veryfast -crf 18 -g 1 -bf 0 -tune fastdecode -movflags +faststart -f mp4 c.mp4
e=$(date +%s.%N)
echo "cache encode 150 frames 1080p all-intra: $(echo "$e - $s" | bc) s, $(stat -c %s c.mp4) bytes"
# Two 4K sources, 4 s each
for i in 1 2; do ffmpeg -hide_banner -loglevel error -y -f lavfi -i testsrc2=s=3840x2160:r=25:d=4 -c:v libx264 -preset ultrafast -crf 23 src$i.mp4; done
P="-vf scale=-2:'min(1080,ih)':flags=bicubic,format=yuv420p -c:v libx264 -preset veryfast -crf 22 -g 12 -bf 0 -tune fastdecode"
s=$(date +%s.%N)
for i in 1 2; do ffmpeg -hide_banner -loglevel error -y -i src$i.mp4 $P serial$i.mp4; done
e=$(date +%s.%N)
echo "proxies one at a time: $(echo "$e - $s" | bc) s"
T=$(( $(nproc) / 2 ))
s=$(date +%s.%N)
ffmpeg -hide_banner -loglevel error -y -i src1.mp4 $P -threads $T par1.mp4 &
ffmpeg -hide_banner -loglevel error -y -i src2.mp4 $P -threads $T par2.mp4 &
wait
e=$(date +%s.%N)
echo "proxies two side by side (threads $T each): $(echo "$e - $s" | bc) s"
cd ..
rm -rf $D
