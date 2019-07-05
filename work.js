class HulaLoopWorkeletProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        this.port.onmessage = (event) => {
            console.log('Worker');
            console.log(event);
        }

        this.port.postMessage('Hello');

        // // Import the HulaLoop C++ addon module
        // const hulaloopAddon = require('bindings')('hulaloop-node.node');
        // console.dir(hulaloopAddon);

        // this.bufferFrames = 1024;
        // this.channels = 2;
        // this.sampleSize = 4;

        // this.hulaloop = new hulaloopAddon.HulaLoop(
        //     (event, data) => {
        //         // TODO: Attach event emitter
        //         console.log(`Event: ${event} -- Data: ${data}`);
        //     },
        //     (errorMsg) => {
        //         console.log(errorMsg);
        //     },
        //     {
        //         input: "test"
        //     }
        // );
        // console.dir(this.hulaloop);

        // this.hulaloopRawBuffer = new ArrayBuffer(this.bufferFrames * this.channels * this.sampleSize);
        // this.hulaloopBuffer = new Float32Array(hulaloopRawBuffer);
        // console.log(this.hulaloopBuffer);
        // console.log(this.hulaloopBuffer.length);
    }

    process(inputs, outputs, parameters) {

        let output = outputs[0];

        // Assume stereo for now
        let outputL = output[0];
        let outputR = output[1];

        for (let i = 0; i < outputL.length + outputR.length; i += 2) {

        }

        return true;
    }
}

registerProcessor('hulaloop-worklet-processor', HulaLoopWorkeletProcessor);