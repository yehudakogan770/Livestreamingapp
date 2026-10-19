import fs from 'fs';
const ort = await import('/home/user/Livestreamingapp/node_modules/onnxruntime-web/dist/ort.node.min.mjs');
const { Marian } = await import('./marian.mts');
ort.env.wasm.numThreads = 1;
const m = await Marian.load(ort, {
  encoder: fs.readFileSync('encoder_model_quantized.onnx'),
  decoder: fs.readFileSync('decoder_model_merged_quantized.onnx'),
  tokenizer: JSON.parse(fs.readFileSync('tokenizer.json', 'utf8')),
  config: JSON.parse(fs.readFileSync('config.json', 'utf8')),
});
console.log(m.tokens.encode('Hello world, how are you today?'));
for (const s of ['Hello world, how are you today?', 'We are going to the park tomorrow because the weather will be nice.', 'Welcome back to the channel.']) {
  const t = Date.now();
  console.log(await m.translate(s), Date.now() - t, 'ms');
}
