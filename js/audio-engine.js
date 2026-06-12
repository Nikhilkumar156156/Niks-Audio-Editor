/**
 * audio-engine.js
 * Manages the AudioContext, real-time effects (EQ, Compressor, Noise Gate),
 * live recording, timeline rendering, and exporting to WAV.
 */

class AudioEngine {
    constructor() {
        this.ctx = null;
        this.sourceNode = null;
        this.renderedBuffer = null; // The merged/edited buffer currently playing
        this.isPlaying = false;
        this.startTime = 0;
        this.pausedAt = 0;

        // Recording state
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;

        // Effects Nodes
        this.highPass = null;
        this.eq1 = null;
        this.eq2 = null;
        this.eq3 = null;
        this.eq4 = null;
        this.eq5 = null;
        this.compressor = null;
        this.masterGain = null;

        // Settings (Default Values)
        this.effectsSettings = {
            noiseGateThreshold: -45, // dB (noise reduction)
            eqBand1Gain: 0,
            eqBand2Gain: 0,
            eqBand3Gain: 0,
            eqBand4Gain: 0,
            eqBand5Gain: 0,
            eqBand1Freq: 100,
            eqBand2Freq: 400,
            eqBand3Freq: 1000,
            eqBand4Freq: 3000,
            eqBand5Freq: 8000,
            eqBand2Q: 1.0,
            eqBand3Q: 1.0,
            eqBand4Q: 1.0,
            compressionEnabled: false,
            enhancerEnabled: false,
            playbackSpeed: 1.0
        };
    }

    init() {
        if (this.ctx) return;
        // Create AudioContext (user gesture required, initiated on play/import/record)
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContextClass();

        // 1. High Pass Filter (80Hz rumble cut)
        this.highPass = this.ctx.createBiquadFilter();
        this.highPass.type = 'highpass';
        this.highPass.frequency.value = 80;

        // 2. 5-Band EQ (Low Shelf, 3 Peak filters, High Shelf)
        this.eq1 = this.ctx.createBiquadFilter();
        this.eq1.type = 'lowshelf';
        this.eq1.frequency.value = this.effectsSettings.eqBand1Freq;
        this.eq1.gain.value = this.effectsSettings.eqBand1Gain;

        this.eq2 = this.ctx.createBiquadFilter();
        this.eq2.type = 'peaking';
        this.eq2.frequency.value = this.effectsSettings.eqBand2Freq;
        this.eq2.Q.value = this.effectsSettings.eqBand2Q;
        this.eq2.gain.value = this.effectsSettings.eqBand2Gain;

        this.eq3 = this.ctx.createBiquadFilter();
        this.eq3.type = 'peaking';
        this.eq3.frequency.value = this.effectsSettings.eqBand3Freq;
        this.eq3.Q.value = this.effectsSettings.eqBand3Q;
        this.eq3.gain.value = this.effectsSettings.eqBand3Gain;

        this.eq4 = this.ctx.createBiquadFilter();
        this.eq4.type = 'peaking';
        this.eq4.frequency.value = this.effectsSettings.eqBand4Freq;
        this.eq4.Q.value = this.effectsSettings.eqBand4Q;
        this.eq4.gain.value = this.effectsSettings.eqBand4Gain;

        this.eq5 = this.ctx.createBiquadFilter();
        this.eq5.type = 'highshelf';
        this.eq5.frequency.value = this.effectsSettings.eqBand5Freq;
        this.eq5.gain.value = this.effectsSettings.eqBand5Gain;

        // 3. Dynamics Compressor
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -24;
        this.compressor.knee.value = 30;
        this.compressor.ratio.value = 12;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.25;

        // 4. Master Gain
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1.0;

        // Connect FX Chain:
        // Source -> HighPass -> eq1 -> eq2 -> eq3 -> eq4 -> eq5 -> Compressor -> MasterGain -> Destination
        this.highPass.connect(this.eq1);
        this.eq1.connect(this.eq2);
        this.eq2.connect(this.eq3);
        this.eq3.connect(this.eq4);
        this.eq4.connect(this.eq5);
        this.eq5.connect(this.compressor);
        this.compressor.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);
    }

    // Update real-time EQ Band Gain
    updateEQBandGain(bandIdx, gain) {
        const key = `eqBand${bandIdx}Gain`;
        this.effectsSettings[key] = gain;
        const eqNode = this[`eq${bandIdx}`];
        if (eqNode) {
            eqNode.gain.setValueAtTime(gain, this.ctx.currentTime);
        }
    }

    // Update real-time EQ Band Frequency
    updateEQBandFreq(bandIdx, freq) {
        const key = `eqBand${bandIdx}Freq`;
        this.effectsSettings[key] = freq;
        const eqNode = this[`eq${bandIdx}`];
        if (eqNode) {
            eqNode.frequency.setValueAtTime(freq, this.ctx.currentTime);
        }
    }

    // Update real-time EQ Band Q factor
    updateEQBandQ(bandIdx, q) {
        const key = `eqBand${bandIdx}Q`;
        this.effectsSettings[key] = q;
        const eqNode = this[`eq${bandIdx}`];
        if (eqNode && eqNode.Q) {
            eqNode.Q.setValueAtTime(q, this.ctx.currentTime);
        }
    }

    // Legacy support for Voice Enhancer quick settings
    updateEQ(low, mid, high) {
        this.updateEQBandGain(1, low);
        this.updateEQBandGain(3, mid);
        this.updateEQBandGain(5, high);
    }

    // Toggle Compressor
    toggleCompression(enabled) {
        this.effectsSettings.compressionEnabled = enabled;
        if (!this.compressor) return;
        
        // If disabled, we bypass it by setting threshold to 0dB or ratio to 1
        if (enabled) {
            this.compressor.threshold.setValueAtTime(-24, this.ctx.currentTime);
            this.compressor.ratio.setValueAtTime(4, this.ctx.currentTime);
        } else {
            this.compressor.threshold.setValueAtTime(0, this.ctx.currentTime);
            this.compressor.ratio.setValueAtTime(1, this.ctx.currentTime);
        }
    }

    // Toggle Voice Enhancer (Boost bass + treble + compress)
    toggleEnhancer(enabled) {
        this.effectsSettings.enhancerEnabled = enabled;
        if (enabled) {
            this.updateEQ(4, 1, 5); // Warm bass boost, crisp highs
            this.toggleCompression(true);
        } else {
            this.updateEQ(0, 0, 0);
            this.toggleCompression(false);
        }
    }

    // Update noise gate threshold (applied during buffer rendering for maximum precision)
    updateNoiseGate(thresholdDb) {
        this.effectsSettings.noiseGateThreshold = thresholdDb;
    }

    // Set playback speed
    setPlaybackSpeed(speed) {
        this.effectsSettings.playbackSpeed = speed;
        if (this.sourceNode && this.isPlaying) {
            this.sourceNode.playbackRate.setValueAtTime(speed, this.ctx.currentTime);
        }
    }

    /**
     * Decode an audio file's array buffer.
     * @param {ArrayBuffer} arrayBuffer
     * @returns {Promise<AudioBuffer>}
     */
    async decodeAudio(arrayBuffer) {
        this.init();
        return await this.ctx.decodeAudioData(arrayBuffer);
    }

    /**
     * Start live recording from micro.
     * @param {Function} onStopCallback - Callback when recording stops, receives the recorded AudioBuffer
     */
    async startRecording(onStopCallback) {
        this.init();
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.recordedChunks = [];
            
            // Check supported mime types
            let options = {};
            if (MediaRecorder.isTypeSupported('audio/webm')) {
                options = { mimeType: 'audio/webm' };
            } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
                options = { mimeType: 'audio/ogg' };
            }

            this.mediaRecorder = new MediaRecorder(stream, options);
            
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    this.recordedChunks.push(e.data);
                }
            };

            this.mediaRecorder.onstop = async () => {
                const blob = new Blob(this.recordedChunks, { type: this.mediaRecorder.mimeType });
                const arrayBuf = await blob.arrayBuffer();
                const audioBuf = await this.decodeAudio(arrayBuf);
                
                // Stop all tracks to release mic
                stream.getTracks().forEach(track => track.stop());
                
                if (onStopCallback) onStopCallback(audioBuf);
            };

            this.mediaRecorder.start();
            this.isRecording = true;
        } catch (err) {
            console.error("Failed to access microphone:", err);
            alert("Microphone access is required for recording. Please verify permissions.");
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
        }
    }

    /**
     * Render the active clips into a single AudioBuffer, applying speed, fades, and offline noise gate.
     * @param {AudioBuffer} originalBuffer - The raw imported/recorded AudioBuffer.
     * @param {Array<Object>} clips - List of segments { originalStart, originalEnd, speed, fadeStart, fadeEnd, deleted }.
     * @returns {AudioBuffer} The rendered AudioBuffer.
     */
    renderTimeline(originalBuffer, clips) {
        this.init();
        
        // Filter out deleted/inactive clips and sort them by timelineStart
        const activeClips = clips.filter(c => !c.deleted).sort((a, b) => a.timelineStart - b.timelineStart);
        if (activeClips.length === 0) {
            // Return a small silent buffer
            return this.ctx.createBuffer(originalBuffer.numberOfChannels, 1000, originalBuffer.sampleRate);
        }

        const sampleRate = originalBuffer.sampleRate;
        const numChannels = originalBuffer.numberOfChannels;

        // 1. Calculate duration and output sample bounds of each clip
        const clipSpecs = activeClips.map(clip => {
            const origDuration = clip.originalEnd - clip.originalStart;
            const clipSpeed = clip.speed || 1.0;
            const renderedDuration = origDuration / clipSpeed;
            const lengthSamples = Math.floor(renderedDuration * sampleRate);

            return {
                clip,
                lengthSamples,
                speed: clipSpeed,
                fadeStartSamples: Math.floor((clip.fadeStart || 0.05) * sampleRate),
                fadeEndSamples: Math.floor((clip.fadeEnd || 0.05) * sampleRate)
            };
        });

        // Calculate maximum end time on the timeline to define output buffer duration
        let maxEndTime = 0;
        for (const spec of clipSpecs) {
            const clipEnd = spec.clip.timelineStart + (spec.lengthSamples / sampleRate);
            if (clipEnd > maxEndTime) maxEndTime = clipEnd;
        }

        const totalSamples = Math.max(1000, Math.floor(maxEndTime * sampleRate));

        // 2. Create the output buffer (initialized to silence)
        const outputBuffer = this.ctx.createBuffer(numChannels, totalSamples, sampleRate);

        // 3. Get noise gate amplitude threshold
        const noiseGateAmp = Math.pow(10, this.effectsSettings.noiseGateThreshold / 20);

        // 4. Render sample-by-sample, mixing overlapping regions
        for (let channel = 0; channel < numChannels; channel++) {
            const originalData = originalBuffer.getChannelData(channel);
            const outputData = outputBuffer.getChannelData(channel);

            for (const spec of clipSpecs) {
                const { clip, lengthSamples, speed, fadeStartSamples, fadeEndSamples } = spec;
                const startSample = Math.floor(clip.originalStart * sampleRate);
                const endSample = Math.floor(clip.originalEnd * sampleRate);
                
                const outputOffset = Math.floor(clip.timelineStart * sampleRate);

                for (let i = 0; i < lengthSamples; i++) {
                    const outIdx = outputOffset + i;
                    if (outIdx >= totalSamples) continue;

                    // Linear interpolation for speed changes
                    const inputIndex = startSample + (i * speed);
                    const i0 = Math.floor(inputIndex);
                    const i1 = Math.min(i0 + 1, endSample - 1);
                    const frac = inputIndex - i0;

                    let sample = 0;
                    if (i0 >= 0 && i0 < originalData.length) {
                        const s0 = originalData[i0];
                        const s1 = originalData[i1];
                        sample = (1 - frac) * s0 + frac * s1;
                    }

                    // Apply offline Noise Gate
                    if (Math.abs(sample) < noiseGateAmp) {
                        sample *= 0.1;
                    }

                    // Apply Fades
                    let gain = 1.0;
                    if (i < fadeStartSamples && fadeStartSamples > 0) {
                        gain = i / fadeStartSamples;
                    } else if (i > lengthSamples - fadeEndSamples && fadeEndSamples > 0) {
                        const samplesFromEnd = lengthSamples - i;
                        gain = samplesFromEnd / fadeEndSamples;
                    }
                    sample *= gain;

                    // Mix samples (mix overlay/overlap instead of overwriting)
                    outputData[outIdx] += sample;
                }
            }
        }

        this.renderedBuffer = outputBuffer;
        return outputBuffer;
    }

    /**
     * Play the currently rendered AudioBuffer.
     * @param {number} timeOffset - Offset in seconds to start playback from.
     * @param {Function} onTimeUpdate - Callback updated during playback.
     * @param {Function} onEnded - Callback triggered when playback finishes.
     */
    play(timeOffset = 0, onTimeUpdate = null, onEnded = null) {
        if (!this.renderedBuffer) return;
        this.init();
        
        this.stop();

        this.sourceNode = this.ctx.createBufferSource();
        this.sourceNode.buffer = this.renderedBuffer;
        this.sourceNode.playbackRate.value = this.effectsSettings.playbackSpeed;

        // Connect: SourceNode -> HighPass (start of effects chain)
        this.sourceNode.connect(this.highPass);

        this.isPlaying = true;
        this.startTime = this.ctx.currentTime - (timeOffset / this.effectsSettings.playbackSpeed);
        this.pausedAt = timeOffset;

        this.sourceNode.start(0, timeOffset);

        // Schedule playback completion trigger
        this.sourceNode.onended = () => {
            if (this.isPlaying) {
                // If not stopped manually, playback reached the end
                this.isPlaying = false;
                this.pausedAt = 0;
                if (onEnded) onEnded();
            }
        };

        // Time tracking loop
        const updateLoop = () => {
            if (this.isPlaying && onTimeUpdate) {
                const elapsed = (this.ctx.currentTime - this.startTime) * this.effectsSettings.playbackSpeed;
                onTimeUpdate(Math.min(elapsed, this.renderedBuffer.duration));
                requestAnimationFrame(updateLoop);
            }
        };
        requestAnimationFrame(updateLoop);
    }

    stop() {
        if (this.sourceNode && this.isPlaying) {
            this.isPlaying = false;
            this.sourceNode.onended = null;
            try {
                this.sourceNode.stop();
            } catch (e) {}
            this.sourceNode.disconnect();
        }
    }

    pause() {
        if (this.isPlaying) {
            this.pausedAt = (this.ctx.currentTime - this.startTime) * this.effectsSettings.playbackSpeed;
            this.stop();
        }
        return this.pausedAt;
    }

    getCurrentPlaybackTime() {
        if (!this.isPlaying) return this.pausedAt;
        return (this.ctx.currentTime - this.startTime) * this.effectsSettings.playbackSpeed;
    }

    /**
     * Export an AudioBuffer as a 16-bit PCM WAV Blob.
     * @param {AudioBuffer} buffer
     * @returns {Blob}
     */
    exportWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1; // 1 = Raw PCM
        const bitDepth = 16;
        
        // Combine channel data
        let result;
        if (numChannels === 2) {
            result = this.interleaveChannels(buffer.getChannelData(0), buffer.getChannelData(1));
        } else {
            result = buffer.getChannelData(0);
        }

        const bufferLength = result.length * 2; // 16-bit is 2 bytes per sample
        const headerBuffer = new ArrayBuffer(44);
        const view = new DataView(headerBuffer);

        /* RIFF identifier */
        this.writeString(view, 0, 'RIFF');
        /* file length */
        view.setUint32(4, 36 + bufferLength, true);
        /* RIFF type */
        this.writeString(view, 8, 'WAVE');
        /* format chunk identifier */
        this.writeString(view, 12, 'fmt ');
        /* format chunk length */
        view.setUint32(16, 16, true);
        /* sample format (raw) */
        view.setUint16(20, format, true);
        /* channel count */
        view.setUint16(22, numChannels, true);
        /* sample rate */
        view.setUint32(24, sampleRate, true);
        /* byte rate (sample rate * block align) */
        view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
        /* block align (channel count * bytes per sample) */
        view.setUint16(32, numChannels * (bitDepth / 8), true);
        /* bits per sample */
        view.setUint16(34, bitDepth, true);
        /* data chunk identifier */
        this.writeString(view, 36, 'data');
        /* data chunk length */
        view.setUint32(40, bufferLength, true);

        // Convert Float32Array to Int16Array PCM
        const pcmBuffer = new ArrayBuffer(bufferLength);
        const pcmView = new DataView(pcmBuffer);
        let offset = 0;
        for (let i = 0; i < result.length; i++, offset += 2) {
            let s = Math.max(-1, Math.min(1, result[i]));
            // scale to 16-bit signed integer
            pcmView.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }

        return new Blob([headerBuffer, pcmBuffer], { type: 'audio/wav' });
    }

    interleaveChannels(ch1, ch2) {
        const length = ch1.length + ch2.length;
        const result = new Float32Array(length);
        let index = 0;
        let inputIndex = 0;
        
        while (index < length) {
            result[index++] = ch1[inputIndex];
            result[index++] = ch2[inputIndex];
            inputIndex++;
        }
        return result;
    }

    writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    /**
     * Export an AudioBuffer as an MP3 Blob using lamejs.
     * @param {AudioBuffer} buffer
     * @returns {Blob}
     */
    exportMp3(buffer) {
        if (typeof lamejs === 'undefined') {
            throw new Error("MP3 Encoder library (lamejs) is not loaded yet.");
        }
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, 128); // 128kbps
        const mp3Data = [];

        const leftData = buffer.getChannelData(0);
        const rightData = numChannels > 1 ? buffer.getChannelData(1) : null;

        // Convert Float32 arrays to Int16 arrays
        const leftInt16 = new Int16Array(leftData.length);
        for (let i = 0; i < leftData.length; i++) {
            let s = Math.max(-1, Math.min(1, leftData[i]));
            leftInt16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        let rightInt16 = null;
        if (rightData) {
            rightInt16 = new Int16Array(rightData.length);
            for (let i = 0; i < rightData.length; i++) {
                let s = Math.max(-1, Math.min(1, rightData[i]));
                rightInt16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
        }

        const sampleBlockSize = 1152;
        for (let i = 0; i < leftInt16.length; i += sampleBlockSize) {
            const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
            let mp3buf;
            if (numChannels === 2) {
                const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
                mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
            } else {
                mp3buf = mp3encoder.encodeBuffer(leftChunk);
            }
            if (mp3buf.length > 0) {
                mp3Data.push(mp3buf);
            }
        }

        const mp3buf = mp3encoder.flush();
        if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
        }

        return new Blob(mp3Data, { type: 'audio/mp3' });
    }

    /**
     * Helper to write ADTS headers for raw AAC packets.
     */
    getAdtsHeader(packetLength, sampleRate, numChannels) {
        const header = new Uint8Array(7);
        const sampleRates = [
            96000, 88200, 64000, 48000, 44100, 32000, 
            24000, 22050, 16000, 12000, 11025, 8000, 7350
        ];
        const freqIdx = sampleRates.indexOf(sampleRate);
        const idx = freqIdx !== -1 ? freqIdx : 4; // default to 44100
        const profile = 2; // AAC LC
        const fullFrameSize = packetLength + 7;

        header[0] = 0xFF;
        header[1] = 0xF1;
        header[2] = ((profile - 1) << 6) | (idx << 2) | (numChannels >> 2);
        header[3] = ((numChannels & 3) << 6) | (fullFrameSize >> 11);
        header[4] = (fullFrameSize >> 3) & 0xFF;
        header[5] = ((fullFrameSize & 7) << 5) | 0x1F;
        header[6] = 0xFC;
        
        return header;
    }

    /**
     * Export an AudioBuffer as an AAC Blob using native WebCodecs AudioEncoder.
     * @param {AudioBuffer} buffer
     * @returns {Promise<Blob>}
     */
    async exportAac(buffer) {
        if (typeof AudioEncoder === 'undefined') {
            throw new Error("AAC WebCodecs encoding is not supported in this browser. Please use Chrome, Edge, or Opera.");
        }

        return new Promise((resolve, reject) => {
            const chunks = [];
            const encoder = new AudioEncoder({
                output: (chunk) => {
                    const packet = new Uint8Array(chunk.byteLength);
                    chunk.copyTo(packet);
                    const header = this.getAdtsHeader(packet.length, buffer.sampleRate, buffer.numberOfChannels);
                    chunks.push(header);
                    chunks.push(packet);
                },
                error: (e) => reject(e)
            });

            encoder.configure({
                codec: 'mp4a.40.2', // AAC-LC
                sampleRate: buffer.sampleRate,
                numberOfChannels: buffer.numberOfChannels,
                bitrate: 128000
            });

            const numChannels = buffer.numberOfChannels;
            const length = buffer.length;
            const totalSamples = length * numChannels;
            const planarBuffer = new Float32Array(totalSamples);
            
            for (let c = 0; c < numChannels; c++) {
                const channelData = buffer.getChannelData(c);
                planarBuffer.set(channelData, c * length);
            }

            const audioData = new AudioData({
                format: 'f32-planar',
                sampleRate: buffer.sampleRate,
                numberOfFrames: length,
                numberOfChannels: numChannels,
                timestamp: 0,
                data: planarBuffer
            });

            encoder.encode(audioData);
            encoder.flush().then(() => {
                const blob = new Blob(chunks, { type: 'audio/aac' });
                resolve(blob);
            }).catch(reject);
        });
    }
}

// Export to window
window.audioEngine = new AudioEngine();
