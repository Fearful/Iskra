import sys
import json

def log(msg):
    sys.stderr.write(f"[Python] {msg}\n")
    sys.stderr.flush()

log("Starting echo script...")

# Simple Loop
while True:
    try:
        line = sys.stdin.readline()
        if not line:
            break
        
        # Echo back
        print(line.strip())
        sys.stdout.flush()
        
        log(f"Echoed: {line.strip()}")
    except KeyboardInterrupt:
        break
