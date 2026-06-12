/**
 * detector.js
 * Contains client-side algorithms for:
 * 1. Silence/Gap Detection
 * 2. DTW (Dynamic Time Warping) based Repeat Phrase Detection
 */

// Helper: Convert amplitude to Decibels
function amplitudeToDb(amplitude) {
    return 20 * Math.log10(Math.max(amplitude, 1e-5));
}

/**
 * Detect silent gaps in an AudioBuffer.
 * @param {AudioBuffer} audioBuffer - The audio buffer to scan.
 * @param {number} thresholdDb - Silence threshold in dB (e.g. -40dB).
 * @param {number} minGapDurationMs - Minimum duration of silence to qualify as a gap (e.g. 300ms).
 * @returns {Object} { gaps: Array<{start, end}>, speech: Array<{start, end}> } in seconds.
 */
function detectGaps(audioBuffer, thresholdDb, minGapDurationMs) {
    const sampleRate = audioBuffer.sampleRate;
    const data = audioBuffer.getChannelData(0); // Analyze first channel
    const totalSamples = data.length;
    const duration = audioBuffer.duration;

    // Define frame size for analysis (e.g., 20ms frames)
    const frameSizeMs = 20;
    const frameSizeSamples = Math.floor((frameSizeMs / 1000) * sampleRate);
    const minGapSamples = Math.floor((minGapDurationMs / 1000) * sampleRate);

    const thresholdAmp = Math.pow(10, thresholdDb / 20);

    const silentFrames = [];
    const totalFrames = Math.ceil(totalSamples / frameSizeSamples);

    // 1. Analyze RMS for each frame
    for (let f = 0; f < totalFrames; f++) {
        const startSample = f * frameSizeSamples;
        const endSample = Math.min(startSample + frameSizeSamples, totalSamples);
        const count = endSample - startSample;

        if (count <= 0) continue;

        let sumSquares = 0;
        for (let i = startSample; i < endSample; i++) {
            sumSquares += data[i] * data[i];
        }
        const rms = Math.sqrt(sumSquares / count);
        const isSilent = rms < thresholdAmp;

        silentFrames.push(isSilent);
    }

    // 2. Group frames into contiguous silent regions
    const gaps = [];
    let inSilence = false;
    let silenceStartFrame = 0;

    for (let f = 0; f < silentFrames.length; f++) {
        if (silentFrames[f]) {
            if (!inSilence) {
                inSilence = true;
                silenceStartFrame = f;
            }
        } else {
            if (inSilence) {
                inSilence = false;
                const silenceEndFrame = f;
                const gapSamples = (silenceEndFrame - silenceStartFrame) * frameSizeSamples;
                if (gapSamples >= minGapSamples) {
                    gaps.push({
                        start: (silenceStartFrame * frameSizeSamples) / sampleRate,
                        end: (silenceEndFrame * frameSizeSamples) / sampleRate
                    });
                }
            }
        }
    }

    // Handle trailing silence
    if (inSilence) {
        const silenceEndFrame = silentFrames.length;
        const gapSamples = (silenceEndFrame - silenceStartFrame) * frameSizeSamples;
        if (gapSamples >= minGapSamples) {
            gaps.push({
                start: (silenceStartFrame * frameSizeSamples) / sampleRate,
                end: Math.min((silenceEndFrame * frameSizeSamples) / sampleRate, duration)
            });
        }
    }

    // 3. Compute speech segments (non-gap segments)
    const speech = [];
    let lastEnd = 0;
    for (const gap of gaps) {
        if (gap.start > lastEnd + 0.05) { // At least 50ms of speech
            speech.push({ start: lastEnd, end: gap.start });
        }
        lastEnd = gap.end;
    }
    if (duration > lastEnd + 0.05) {
        speech.push({ start: lastEnd, end: duration });
    }

    return { gaps, speech };
}

/**
 * Compute Subsequence Dynamic Time Warping (sDTW) distance for 8D spectral sequences.
 * Finds the best match of query sequence within a longer reference sequence.
 * @param {Array<Float32Array>} query - Shorter sequence (N x 8)
 * @param {Array<Float32Array>} reference - Longer sequence (M x 8)
 * @returns {number} Normalized sDTW distance
 */
function computeSubsequenceSpectralDTW(query, reference) {
    const n = query.length;
    const m = reference.length;
    if (n === 0 || m === 0) return Infinity;

    // Create DP table
    const dtw = Array.from({ length: n + 1 }, () => new Float32Array(m + 1).fill(Infinity));

    // Initialize first row to 0: search can start anywhere in reference
    for (let j = 0; j <= m; j++) {
        dtw[0][j] = 0;
    }

    // Helper to compute Euclidean distance between two 8D vectors
    function euclideanDistance(v1, v2) {
        let sum = 0;
        for (let k = 0; k < 8; k++) {
            const diff = v1[k] - v2[k];
            sum += diff * diff;
        }
        return Math.sqrt(sum);
    }

    for (let i = 1; i <= n; i++) {
        const qVec = query[i - 1];
        for (let j = 1; j <= m; j++) {
            const cost = euclideanDistance(qVec, reference[j - 1]);
            dtw[i][j] = cost + Math.min(
                dtw[i - 1][j],      // Insertion
                dtw[i][j - 1],      // Deletion
                dtw[i - 1][j - 1]   // Match
            );
        }
    }

    // Find the minimum distance in the last row
    let minDistance = Infinity;
    for (let j = 1; j <= m; j++) {
        if (dtw[n][j] < minDistance) {
            minDistance = dtw[n][j];
        }
    }

    return minDistance / n;
}

/**
 * Extract 8-band spectrogram of an audio segment and apply z-score normalization.
 * @param {Float32Array} channelData - Full audio channel data.
 * @param {number} startSec - Segment start time in seconds.
 * @param {number} endSec - Segment end time in seconds.
 * @param {number} sampleRate - Audio sample rate.
 * @param {number} frameRateHz - Samples per second for the spectrogram (e.g. 20Hz).
 * @returns {Object} Normalized spectrogram (2D array) and raw average energy.
 */
function extractSpectrogram(channelData, startSec, endSec, sampleRate, frameRateHz = 20) {
    const startSample = Math.floor(startSec * sampleRate);
    const endSample = Math.floor(endSec * sampleRate);
    const length = endSample - startSample;
    if (length <= 0) return { normalized: [], energy: 0 };

    const frameStep = Math.floor(sampleRate / frameRateHz);
    const totalFrames = Math.max(1, Math.ceil(length / frameStep));

    const N = 2048;
    const numBands = 8;

    // Log-spaced frequencies from 150Hz to 8000Hz (capped below Nyquist)
    const minFreq = 150;
    const maxFreq = Math.min(8000, sampleRate / 2 - 100);
    const freqs = [];
    for (let i = 0; i < numBands; i++) {
        const f = minFreq * Math.pow(maxFreq / minFreq, i / (numBands - 1));
        freqs.push(f);
    }

    // Precalculate sine and cosine tables with Hann window
    const cosTable = Array.from({ length: numBands }, () => new Float32Array(N));
    const sinTable = Array.from({ length: numBands }, () => new Float32Array(N));
    for (let k = 0; k < numBands; k++) {
        const omega = (2 * Math.PI * freqs[k]) / sampleRate;
        for (let n = 0; n < N; n++) {
            const w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
            cosTable[k][n] = w * Math.cos(omega * n);
            sinTable[k][n] = w * Math.sin(omega * n);
        }
    }

    const spectrogram = [];

    // Analyze each frame
    for (let f = 0; f < totalFrames; f++) {
        const frameStart = startSample + f * frameStep;

        // Extract N samples, pad with zero if out of bounds
        const frameData = new Float32Array(N);
        for (let n = 0; n < N; n++) {
            const idx = frameStart + n;
            if (idx < endSample) {
                frameData[n] = channelData[idx];
            } else {
                frameData[n] = 0;
            }
        }

        // Compute 8 bands
        const bandMags = new Float32Array(numBands);
        for (let k = 0; k < numBands; k++) {
            let real = 0;
            let imag = 0;
            const cTab = cosTable[k];
            const sTab = sinTable[k];
            for (let n = 0; n < N; n++) {
                const val = frameData[n];
                real += val * cTab[n];
                imag += val * sTab[n];
            }
            const magnitude = Math.sqrt(real * real + imag * imag);
            // Logarithmic compression
            bandMags[k] = Math.log10(1 + 1000 * magnitude);
        }
        spectrogram.push(bandMags);
    }

    // Z-score normalize each band independently
    const normalized = Array.from({ length: totalFrames }, () => new Float32Array(numBands));
    for (let k = 0; k < numBands; k++) {
        let sum = 0;
        for (let f = 0; f < totalFrames; f++) {
            sum += spectrogram[f][k];
        }
        const mean = sum / totalFrames;

        let sumSqDiff = 0;
        for (let f = 0; f < totalFrames; f++) {
            const diff = spectrogram[f][k] - mean;
            sumSqDiff += diff * diff;
        }
        const std = Math.sqrt(sumSqDiff / totalFrames) || 1e-5;

        for (let f = 0; f < totalFrames; f++) {
            normalized[f][k] = (spectrogram[f][k] - mean) / std;
        }
    }

    // Compute raw average RMS/volume energy of this segment
    let sumSquares = 0;
    for (let i = startSample; i < endSample; i++) {
        sumSquares += channelData[i] * channelData[i];
    }
    const energy = Math.sqrt(sumSquares / Math.max(length, 1));

    return {
        normalized,
        energy
    };
}

/**
 * Detect repeated phrases among non-silent speech segments.
 * Compares neighboring segments using 8D subsequence DTW on spectrograms.
 * @param {AudioBuffer} audioBuffer - Full audio buffer.
 * @param {Array<Object>} speechSegments - Array of speech segment bounds {start, end}.
 * @param {number} similarityThreshold - DTW distance threshold (lower is more similar, e.g. 0.45).
 * @returns {Array<Object>} List of segments annotated with status ('normal', 'repeat', 'final') and group IDs.
 */
function detectRepeats(audioBuffer, speechSegments, similarityThreshold = 0.45) {
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;

    // 1. Extract spectrograms for all segments
    const segments = speechSegments.map((seg, index) => {
        const specResult = extractSpectrogram(channelData, seg.start, seg.end, sampleRate);
        return {
            id: index,
            start: seg.start,
            end: seg.end,
            duration: seg.end - seg.start,
            spectrogram: specResult.normalized,
            energy: specResult.energy,
            type: 'normal',
            groupId: null
        };
    });

    let currentGroupId = 1;

    // Helper: check if two durations are compatible for matching
    function durationMatches(dur1, dur2) {
        const minDur = Math.min(dur1, dur2);
        const maxDur = Math.max(dur1, dur2);
        // Shorter segment must be at least 1.0 seconds and at least 45% of the longer one
        return minDur >= 1.0 && (minDur / maxDur) >= 0.45;
    }

    // 2. Scan and compare segments. Look ahead up to 4 segments.
    const windowSize = 4;
    const matched = new Set();

    for (let i = 0; i < segments.length; i++) {
        if (matched.has(i)) continue;

        let repeatGroup = [i];

        for (let w = 1; w <= windowSize; w++) {
            const j = i + w;
            if (j >= segments.length) break;
            if (matched.has(j)) continue;

            const segI = segments[i];
            const segJ = segments[j];

            if (durationMatches(segI.duration, segJ.duration)) {
                // Check volume/energy compatibility
                if (segI.energy < 0.015 || segJ.energy < 0.015) {
                    continue; // Skip quiet fragments/noise
                }

                const minEnergy = Math.min(segI.energy, segJ.energy);
                const maxEnergy = Math.max(segI.energy, segJ.energy);
                if (minEnergy / maxEnergy < 0.4) {
                    continue; // Skip segments with completely different volume dynamics
                }

                // Use subsequence spectral DTW
                let distance;
                if (segI.spectrogram.length < segJ.spectrogram.length) {
                    distance = computeSubsequenceSpectralDTW(segI.spectrogram, segJ.spectrogram);
                } else {
                    distance = computeSubsequenceSpectralDTW(segJ.spectrogram, segI.spectrogram);
                }

                // Tighten matching threshold for subsequence DTW
                const calibratedThreshold = similarityThreshold * 0.65;
                if (distance < calibratedThreshold) {
                    repeatGroup.push(j);
                    matched.add(j);
                }
            }
        }

        // If we found duplicates, mark the earlier ones as 'repeat' (yellow)
        // and the very last one as 'final' (green).
        if (repeatGroup.length > 1) {
            matched.add(i); // Mark the base segment as matched
            for (let k = 0; k < repeatGroup.length - 1; k++) {
                const idx = repeatGroup[k];
                segments[idx].type = 'repeat';
                segments[idx].groupId = currentGroupId;
            }
            const lastIdx = repeatGroup[repeatGroup.length - 1];
            segments[lastIdx].type = 'final';
            segments[lastIdx].groupId = currentGroupId;
            currentGroupId++;
        }
    }

    // Return segments without internal spectrogram data
    return segments.map(seg => ({
        id: seg.id,
        start: seg.start,
        end: seg.end,
        type: seg.type,
        groupId: seg.groupId
    }));
}

// Export functions to window scope for easy client-side scripts imports
window.AudioDetector = {
    detectGaps,
    detectRepeats,
    extractSpectrogram,
    computeSubsequenceSpectralDTW
};
