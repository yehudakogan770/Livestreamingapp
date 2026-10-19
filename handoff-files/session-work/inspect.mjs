import * as ort from '/home/user/Livestreamingapp/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs';
import fs from 'node:fs';
ort.env.wasm.numThreads = 1;
for (const f of ['encoder_model_quantized.onnx', 'decoder_model_merged_quantized.onnx']) {
  const s = await ort.InferenceSession.create(fs.readFileSync(process.argv[2] + '/onnx/' + f));
  console.log(f, 'IN', s.inputNames.join(','), '\nOUT', s.outputNames.join(','));
}
