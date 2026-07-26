import math
import numpy as np

def compute_subsequence_spectral_dtw(query, reference):
    n = len(query)
    m = len(reference)
    if n == 0 or m == 0:
        return float('inf')

    dtw = np.full((n + 1, m + 1), float('inf'))
    for j in range(m + 1):
        dtw[0][j] = 0

    def euclidean_distance(v1, v2):
        return math.sqrt(sum((a - b) ** 2 for a, b in zip(v1, v2)))

    for i in range(1, n + 1):
        q_vec = query[i - 1]
        for j in range(1, m + 1):
            cost = euclidean_distance(q_vec, reference[j - 1])
            dtw[i][j] = cost + min(
                dtw[i - 1][j],      # Insertion
                dtw[i][j - 1],      # Deletion
                dtw[i - 1][j - 1]   # Match
            )

    min_distance = float('inf')
    for j in range(1, m + 1):
        if dtw[n][j] < min_distance:
            min_distance = dtw[n][j]

    return min_distance / n

def extract_spectrogram(channel_data, start_sec, end_sec, sample_rate, frame_rate_hz=20):
    start_sample = int(start_sec * sample_rate)
    end_sample = int(end_sec * sample_rate)
    length = end_sample - start_sample
    if length <= 0:
        return {"normalized": [], "energy": 0}

    frame_step = int(sample_rate / frame_rate_hz)
    total_frames = max(1, math.ceil(length / frame_step))

    N = 2048
    num_bands = 8

    min_freq = 150
    max_freq = min(8000, sample_rate / 2 - 100)
    freqs = []
    for i in range(numBands := num_bands):
        f = min_freq * ((max_freq / min_freq) ** (i / (num_bands - 1)))
        freqs.append(f)

    cos_table = np.zeros((num_bands, N))
    sin_table = np.zeros((num_bands, N))
    for k in range(num_bands):
        omega = (2 * math.pi * freqs[k]) / sample_rate
        for n in range(N):
            w = 0.5 * (1 - math.cos((2 * math.pi * n) / (N - 1)))
            cos_table[k][n] = w * math.cos(omega * n)
            sin_table[k][n] = w * math.sin(omega * n)

    spectrogram = []

    for f in range(total_frames):
        frame_start = start_sample + f * frame_step
        frame_data = np.zeros(N)
        for n in range(N):
            idx = frame_start + n
            if idx < end_sample:
                frame_data[n] = channel_data[idx]

        band_mags = np.zeros(num_bands)
        for k in range(num_bands):
            real = 0
            imag = 0
            c_tab = cos_table[k]
            s_tab = sin_table[k]
            for n in range(N):
                val = frame_data[n]
                real += val * c_tab[n]
                imag += val * s_tab[n]
            magnitude = math.sqrt(real * real + imag * imag)
            band_mags[k] = math.log10(1 + 1000 * magnitude)
        spectrogram.append(band_mags)

    normalized = np.zeros((total_frames, num_bands))
    for k in range(num_bands):
        sum_val = 0
        for f in range(total_frames):
            sum_val += spectrogram[f][k]
        mean = sum_val / total_frames

        sum_sq_diff = 0
        for f in range(total_frames):
            diff = spectrogram[f][k] - mean
            sum_sq_diff += diff * diff
        std = math.sqrt(sum_sq_diff / total_frames) or 1e-5

        for f in range(total_frames):
            normalized[f][k] = (spectrogram[f][k] - mean) / std

    sum_squares = 0
    for i in range(start_sample, end_sample):
        sum_squares += channel_data[i] * channel_data[i]
    energy = math.sqrt(sum_squares / max(length, 1))

    return {
        "normalized": normalized,
        "energy": energy
    }

# Unit tests
print("Running Python translation unit tests...")

# Test 1
spec1 = [
    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
]
spec2 = [
    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
]
d1 = compute_subsequence_spectral_dtw(spec1, spec2)
print(f"Test 1 (Identical): DTW Distance = {d1}")
assert math.isclose(d1, 0.0, abs_tol=1e-9), "Distance between identical spectrograms should be 0"

# Test 2
spec3 = [
    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
    [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
]
d2 = compute_subsequence_spectral_dtw(spec1, spec3)
print(f"Test 2 (Stretched): DTW Distance = {d2}")
assert d2 < 0.25, "Distance for time-stretched spectrogram should be small"

# Test 3
spec4 = [
    [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2],
    [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1]
]
d3 = compute_subsequence_spectral_dtw(spec1, spec4)
print(f"Test 3 (Different): DTW Distance = {d3}")
assert d3 > 0.5, "Distance for different spectrograms should be large"

# Test 4
mock_channel_data = np.zeros(4000)
sample_rate = 4000
for i in range(4000):
    if i >= 800 and i < 3200:
        mock_channel_data[i] = math.sin(2 * math.pi * 440 * i / sample_rate) * 0.5

spectrogram_result = extract_spectrogram(mock_channel_data, 0, 1.0, sample_rate, 20)
print(f"Test 4 (Spectrogram): Length = {len(spectrogram_result['normalized'])}")
assert len(spectrogram_result['normalized']) == 20, "Spectrogram should contain 20 frames"
assert len(spectrogram_result['normalized'][0]) == 8, "Each spectrogram frame should have 8 bands"

print("✅ All Python translation tests passed successfully!")
