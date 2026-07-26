import os

terms = ["extractEnvelope", "computeDTW", "computeSubsequenceDTW", "AudioDetector"]
project_dir = r"C:\Users\NIKHIL KUMAR\.gemini\antigravity\scratch\red-black-audio-editor"

for root, dirs, files in os.walk(project_dir):
    for file in files:
        if file.endswith(('.js', '.html', '.css')):
            path = os.path.join(root, file)
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    for term in terms:
                        if term in content:
                            print(f"Found '{term}' in {path}")
            except Exception as e:
                print(f"Error reading {path}: {e}")
