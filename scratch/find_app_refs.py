with open(r"C:\Users\NIKHIL KUMAR\.gemini\antigravity\scratch\red-black-audio-editor\js\app.js", 'r', encoding='utf-8') as f:
    for i, line in enumerate(f, 1):
        if "AudioDetector" in line:
            print(f"Line {i}: {line.strip()}")
