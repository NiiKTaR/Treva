/* Real-time AudioWorkletProcessor for uninterrupted PCM capture even in background tabs */
class TrevaPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 4096;
    this.leftBuf = new Float32Array(this.chunkSize);
    this.rightBuf = new Float32Array(this.chunkSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      // Emit silence so live stream stays continuous
      const frames = 128;
      for (let i = 0; i < frames; i++) {
        this.leftBuf[this.offset] = 0;
        this.rightBuf[this.offset] = 0;
        this.offset++;
        if (this.offset >= this.chunkSize) {
          this.flush();
        }
      }
      return true;
    }

    const ch0 = input[0];
    const ch1 = input.length > 1 ? input[1] : ch0;
    const len = ch0.length;

    for (let i = 0; i < len; i++) {
      this.leftBuf[this.offset] = ch0[i];
      this.rightBuf[this.offset] = ch1[i];
      this.offset++;
      if (this.offset >= this.chunkSize) {
        this.flush();
      }
    }
    return true;
  }

  flush() {
    const lCopy = this.leftBuf;
    const rCopy = this.rightBuf;
    this.port.postMessage(
      { left: lCopy.buffer, right: rCopy.buffer },
      [lCopy.buffer, rCopy.buffer]
    );
    this.leftBuf = new Float32Array(this.chunkSize);
    this.rightBuf = new Float32Array(this.chunkSize);
    this.offset = 0;
  }
}

registerProcessor('treva-pcm-processor', TrevaPcmProcessor);
