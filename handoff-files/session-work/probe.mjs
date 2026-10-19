const h = await import(process.argv[2]);
const p = h.probe(process.argv[3]);
console.log(p.frames, p.seconds, p.video, p.ok);
console.log(h.videosIn(process.argv[4]).length);
