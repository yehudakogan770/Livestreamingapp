import fs from 'node:fs';
const wav = fs.readFileSync('test.wav'); let off = 12; while (wav.toString('ascii', off, off + 4) !== 'data') off += 8 + wav.readUInt32LE(off + 4);
const n = wav.readUInt32LE(off + 4) / 2;
for (let s = 0; s < 8; s++) { let sum = 0, pk = 0; for (let i = s * 16000; i < Math.min(n, (s + 1) * 16000); i++) { const v = wav.readInt16LE(off + 8 + i * 2) / 32768; sum += v * v; pk = Math.max(pk, Math.abs(v)); } console.log(s, 'rms', Math.sqrt(sum / 16000).toFixed(4), 'peak', pk.toFixed(3)); }
