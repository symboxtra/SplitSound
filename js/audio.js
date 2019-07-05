import * as dom from './dom.js';
import settings from './settings.js';

// TODO: See if this actually propogates outside the module
window.AudioContext = (window.AudioContext || window.webkitAudioContext);

let hulaloopAddon = null;
if (settings.isElectron) {
    hulaloopAddon = require('bindings')('hulaloop-node.node');
}

// Grab the sample rate of the default device
// We'll only do this once even though it might change as
// the default device switches
// TODO: See if there's a less wasteful way to do this
let testContext = new AudioContext();
let DEFAULT_SAMPLE_RATE = testContext.sampleRate;
testContext.close();
testContext = null;

// WebAudio latency hints from lowest to highest latency
// https://developer.mozilla.org/en-US/docs/Web/API/AudioContextLatencyCategory
const DEFAULT_LATENCY_MODE = 1;
const latencyHints = ['interactive', 'balanced', 'playback'];

const vizModes = ['line', 'bar', 'none'];

class AudioManager {
    constructor(sampleRate = null, latencyMode = 1, createVisualizer = true) {
        this.sampleRate = sampleRate;
        this.latencyMode = latencyMode;
        this.hulaloop = null;
        this.hulaloopAudioNode = null;

        if (this.sampleRate == null) {
            this.sampleRate = DEFAULT_SAMPLE_RATE;
        }

        // Range check sample rate
        if (this.sampleRate < 0) {
            console.warn(`Invalid sample rate: ${this.sampleRate}. Defaulting to ${DEFAULT_SAMPLE_RATE}.`);
            this.sampleRate = DEFAULT_SAMPLE_RATE;
        }

        // Range check latency mode
        if (this.latencyMode < 0 || this.latencyMode > latencyHints.length) {
            console.warn(`Invalid latency mode: ${this.latencyMode}. Defaulting to ${DEFAULT_LATENCY_MODE} (${latencyHints[DEFAULT_LATENCY_MODE]}).`);
            this.latencyMode = DEFAULT_LATENCY_MODE;
        }

        this.context = new AudioContext({ latencyHint: latencyHints[this.latencyMode], sampleRate: this.sampleRate });

        if (this.context.sampleRate != this.sampleRate) {
            console.warn(`AudioContext ignored sampleRate option.\n
                          Preferred: ${this.sampleRate}  Current: ${this.context.sampleRate}`);
        }

        // Create local audio element
        // MediaElementSource cries if created twice
        // from same element, so replace the existing DOM
        let newLocalAudio = new Audio();
        newLocalAudio.id = dom.localAudio.id;
        newLocalAudio.className = dom.localAudio.className;
        newLocalAudio.autoplay = dom.localAudio.autoplay;
        newLocalAudio.controls = dom.localAudio.controls;

        dom.localAudio.remove();
        dom.localAudio.pause();
        dom.setLocalAudio(newLocalAudio);
        localMedia.appendChild(dom.localAudio);

        // Edge doesn't have this
        if (this.context.createMediaStreamDestination) {
            this.outgoingRemoteStreamNode = this.context.createMediaStreamDestination();
        } else {
            // Create a dummy node and define stream
            this.outgoingRemoteStreamNode = this.context.createGain();
            this.outgoingRemoteStreamNode.stream = null;
            settings.enableReceiverOnly();
        }
        this.localAudioElementNode = this.context.createMediaElementSource(dom.localAudio);
        this.incomingRemoteGainNode = this.context.createGain();
        this.outgoingRemoteGainNode = this.context.createGain();

        this.incomingRemoteGainNode.connect(this.context.destination);
        this.localAudioElementNode.connect(this.outgoingRemoteGainNode);
        this.outgoingRemoteGainNode.connect(this.outgoingRemoteStreamNode);

        if (false) {
            // Listen to what's going out in the left for reference
            let panL = this.context.createStereoPanner();
            panL.pan.value = -1;
            panL.connect(this.context.destination);
            this.outgoingRemoteGainNode.connect(panL);

            // Listen to what's coming in in the right ear
            let panR = this.context.createStereoPanner();
            panR.pan.value = 1;
            panR.connect(this.context.destination);
            this.incomingRemoteGainNode.disconnect();
            this.incomingRemoteGainNode.connect(panR);
        }

        if (createVisualizer) {
            this.visualizer = new Visualizer(this.context, [
                this.incomingRemoteGainNode,
                this.outgoingRemoteGainNode
            ]);
        } else {
            this.visualizer = null;
        }

        // Create hulaloop instance
        if (settings.isElectron && hulaloopAddon) {
            this.hulaloop = new hulaloopAddon.HulaLoop(
                (event, data) => {
                    // TODO: Attach event emitter
                    console.log(`Event: ${event} -- Data: ${data}`);
                },
                (errorMsg) => {
                    // TODO: Make this not annoying
                    alert(errorMsg);
                },
                {}
            );
        } else {
            settings.showHulaloopDevices = false;
            dom.toggleElectronOptions();
        }
    }

    reset() {
        // Stop HulaLoop processing
        this.hulaloop.stopCapture();
        if (this.hulaloopAudioNode) {
            this.hulaloopAudioNode.disconnect();
        }
    }

    // This is permanent. No revival of the context or hulaloop
    close() {
        this.context.close();

        // Stop visualizer
        clearTimeout(this.timeoutId);

        if (this.hulaloop) {
            this.hulaloop.stopCapture();
        }
    }

    /**
     * Source audio from the HulaLoop Node addon.
     * @param {string} device Input device name
     */
    setupLocalMediaStreamFromHulaLoop(device) {
        // AudioContext gets suspended if created before
        // a user interaction https://goo.gl/7K7WLu
        this.context.resume();

        // Set the input before starting capture
        // Don't start the stream unless this succeeds
        if (device) {
            let success = this.hulaloop.setInput(device);
            if (!success) {
                // Error message will be printed via callback
                return;
            }
        }

        let bufferFrames = 1024;
        let channels = 2;
        let sampleSize = 4;
        this.hulaloopAudioNode = this.context.createScriptProcessor(bufferFrames, 0, channels);

        console.dir(this.hulaloop);
        console.log(this.context.sampleRate);

        let devices = this.hulaloop.getDevices();
        console.log(devices);

        let hulaloopRawBuffer = new ArrayBuffer(bufferFrames * channels * sampleSize);
        let hulaloopBuffer = new Float32Array(hulaloopRawBuffer);

        let outputBuffer;
        let outputDataL;
        let outputDataR;
        let i, j;

        this.hulaloopAudioNode.onaudioprocess = (e) => {
            outputBuffer = e.outputBuffer;

            // Get our data
            this.hulaloop.readBuffer(hulaloopRawBuffer);

            // Assume stereo for now
            outputDataL = outputBuffer.getChannelData(0);
            outputDataR = outputBuffer.getChannelData(1);

            // Loop over our data and convert from interleaved to planar
            for (i = 0, j = 0; i < hulaloopBuffer.length - 1; i += 2, j++) {
                outputDataL[j] = hulaloopBuffer[i];
                outputDataR[j] = hulaloopBuffer[i + 1];
            }
        };

        this.hulaloopAudioNode.connect(this.outgoingRemoteGainNode);
        this.hulaloop.startCapture();

        return this.hulaloop;
    }
}

class Visualizer {
    constructor(context, inputNodes = []) {
        if (!context) {
            console.error('No audio context passed to Visualizer constructor.');
            return;
        }

        this.context = context;
        this.inputNodes = [];
        this.timeoutId = -1;
        this.mode = 'line';
        this.lineColor = 'yellow';
        this.barColor = 'yellow';

        // Analyzer/FFT setup
        this.analyzerNode = this.context.createAnalyser();
        this.analyzerNode.smoothingTimeConstant = 0.6;
        this.analyzerNode.fftSize = 2048;
        this.analyzerNode.minDecibels = -100;
        this.analyzerNode.maxDecibels = -10;

        // Allocate buffer
        this.data = new Uint8Array(this.analyzerNode.frequencyBinCount);

        // Connect desired input nodes
        for (let node of inputNodes) {
            this.addInputNode(node);
        }

        // Bind to this since it will be called in other contexts
        this.update = this.update.bind(this);

        // Start updating
        this.timeoutId = setTimeout(() => requestAnimationFrame(this.update), 0);
    }

    setColor(color) {
        this.lineColor = color;
        this.barColor = color;
    }

    setMode(mode) {
        if (!vizModes.includes(mode)) {
            console.warn(`Unsupported visualizer mode: ${mode}`);
            return;
        }

        this.mode = mode;
    }

    addInputNode(node) {
        node.connect(this.analyzerNode);
        this.inputNodes.push(node);
    }

    // Based on: https://stackoverflow.com/a/49371349/6798110
    // and https://github.com/webrtc/samples/blob/gh-pages/src/content/peerconnection/webaudio-output/js/main.js
    update() {
        let width = dom.visualizerCanvas.width;
        let height = dom.visualizerCanvas.height;

        // Clear old points
        dom.vizCtx.clearRect(0, 0, width, height);
        dom.vizCtx.fillStyle = 'black';
        dom.vizCtx.fillRect(0, 0, width, height);

        if (this.mode === 'none') {
            // Slow the rate if we aren't actually drawing
            this.timeoutId = setTimeout(() => {
                requestAnimationFrame(this.update);
            }, 200);

            return;
        }

        // Get the FFT data
        this.analyzerNode.getByteFrequencyData(this.data);

        // Stroke colors
        dom.vizCtx.strokeStyle = this.lineColor;
        dom.vizCtx.fillStyle = this.barColor;

        dom.vizCtx.beginPath();
        dom.vizCtx.moveTo(0, height);

        let barWidth = (width / (this.analyzerNode.frequencyBinCount / 9.3)); // Estimation for now
        let x = 0;
        let t = 1;

        let next = 1;
        for (let i = 0; i < this.analyzerNode.frequencyBinCount; i += next) {
            // Calling Math.round doesn't go so well...
            // Hack our own
            next += i / (this.analyzerNode.frequencyBinCount / 16);
            next = next - (next % 1);

            if (this.mode === 'line') {
                let p0 = (i > 0) ? { x: x - barWidth, y: height - this.data[i - 1] } : { x: 0, y: 0 };
                let p1 = { x: x, y: height - this.data[i] };
                let p2 = (i < this.analyzerNode.frequencyBinCount - 1) ? { x: x + barWidth, y: height - this.data[i + 1] } : p1;
                let p3 = (i < this.analyzerNode.frequencyBinCount - 2) ? { x: x + 2 * barWidth, y: height - this.data[i + 2] } : p1;

                let cp1x = p1.x + (p2.x - p0.x) / 6 * t;
                let cp1y = p1.y + (p2.y - p0.y) / 6 * t;

                let cp2x = p2.x - (p3.x - p1.x) / 6 * t;
                let cp2y = p2.y - (p3.y - p1.y) / 6 * t;

                dom.vizCtx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
            } else if (this.mode === 'bar') {
                dom.vizCtx.fillRect(x, height - this.data[i], barWidth, this.data[i]);
            }

            x += barWidth + 1;
        }

        dom.vizCtx.stroke();

        this.timeoutId = setTimeout(() => {
            requestAnimationFrame(this.update);
        }, 20);
    }
}

// Single instance of AudioManager
let am;
am = createAudioManager();

/**
 * Factory function for AudioManager in case we need to add
 * some better cleanup logic later
 *
 * All parameters are optional.
 */
function createAudioManager(sampleRate, latencyHint, createVisualizer) {
    // Stop old context
    if (am) {
        am.close();
        am = null;
    }

    am = new AudioManager(sampleRate, latencyHint, createVisualizer);

    return am;
}

export { am, createAudioManager, Visualizer };