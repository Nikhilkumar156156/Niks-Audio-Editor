with open(r"C:\Users\NIKHIL KUMAR\.gemini\antigravity\scratch\red-black-audio-editor\js\app.js", 'r', encoding='utf-8') as f:
    for i, line in enumerate(f, 1):
        if "eq-" in line.lower() or "eqlow" in line.lower() or "eqmid" in line.lower() or "eqhigh" in line.lower():
            print(f"Line {i}: {line.strip()}")
