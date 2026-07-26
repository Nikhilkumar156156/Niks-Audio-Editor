/**
 * test_detector.js
 * Unit test for DTW and energy envelope calculations.
 */

// Mock window for Node environment compatibility
global.window = {};
require('../js/detector.js');

const detector = global.window.AudioDetector;

function assert(condition, message) {
    if (!condition) {
        console.error("❌ ASSERTION FAILED: " + message);
        process.exit(1);
    }
}

console.log("Starting detector unit tests...");

// Test 1: DTW matching identical spectrograms
const spec1 = [
    new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
    new Float32Array([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
];
const spec2 = [
    new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
    new Float32Array([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
];
const d1 = detector.computeSubsequenceSpectralDTW(spec1, spec2);
console.log(`Test 1 (Identical): DTW Distance = ${d1}`);
assert(d1 === 0, "Distance between identical spectrograms should be 0");

// Test 2: DTW matching slightly stretched/warped spectrograms
const spec3 = [
    new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
    new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
    new Float32Array([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]),
    new Float32Array([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
];
const d2 = detector.computeSubsequenceSpectralDTW(spec1, spec3);
console.log(`Test 2 (Stretched): DTW Distance = ${d2}`);
assert(d2 < 0.25, "Distance for time-stretched spectrogram should be small");

// Test 3: DTW matching completely different spectrograms
const spec4 = [
    new Float32Array([0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2]),
    new Float32Array([0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1])
];
const d3 = detector.computeSubsequenceSpectralDTW(spec1, spec4);
console.log(`Test 3 (Different): DTW Distance = ${d3}`);
assert(d3 > 0.5, "Distance for different spectrograms should be large");

// Test 4: Spectrogram extraction mock
const mockChannelData = new Float32Array(4000);
// Generate a 1-second segment at 4000Hz (sampleRate) containing:
// - 0.2s silence
// - 0.6s loud tone (sine wave)
// - 0.2s silence
const sampleRate = 4000;
for (let i = 0; i < 4000; i++) {
    if (i >= 800 && i < 3200) {
        mockChannelData[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.5; // Tone
    } else {
        mockChannelData[i] = 0; // Silence
    }
}

// Extract spectrogram at 20Hz (should give 20 values)
const spectrogramResult = detector.extractSpectrogram(mockChannelData, 0, 1.0, sampleRate, 20);
console.log(`Test 4 (Spectrogram): Length = ${spectrogramResult.normalized.length}`);
assert(spectrogramResult.normalized.length === 20, "Spectrogram should contain 20 frames");
assert(spectrogramResult.normalized[0].length === 8, "Each spectrogram frame should have 8 bands");

// Test 5: Gap detection mock AudioBuffer compatibility
// Let's mock a simple object resembling an AudioBuffer
const mockAudioBuffer = {
    sampleRate: 4000,
    duration: 1.0,
    numberOfChannels: 1,
    getChannelData: () => mockChannelData
};

const results = detector.detectGaps(mockAudioBuffer, -30, 200);
console.log("Test 5 (Gap Detection):", JSON.stringify(results));
assert(results.gaps.length === 2, "Should detect 2 silent gaps (start and end)");
assert(results.speech.length === 1, "Should detect 1 speech segment (center tone)");
assert(Math.abs(results.speech[0].start - 0.2) < 0.05, "Speech segment should start around 0.2s");
assert(Math.abs(results.speech[0].end - 0.8) < 0.05, "Speech segment should end around 0.8s");

console.log("✅ All detector tests passed successfully!");
