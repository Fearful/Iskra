
import sys
import json
import time

def process_data(data):
    # Simulate heavy processing
    time.sleep(0.5)
    return {
        "processed": True,
        "original": data,
        "result": "Analysis complete",
        "timestamp": time.time()
    }

def main():
    print(json.dumps({"type": "status", "msg": "Python processor started"}))
    sys.stdout.flush()

    for line in sys.stdin:
        try:
            line = line.strip()
            if not line:
                continue

            data = json.loads(line)
            request_id = data.pop("requestId", None)
            result = process_data(data)

            response = {"type": "result", "data": result}
            if request_id:
                response["requestId"] = request_id

            print(json.dumps(response))
            sys.stdout.flush()
        except Exception as e:
            error_response = {"type": "error", "msg": str(e)}
            # Try to include requestId in error response too
            try:
                if 'data' in dir() and isinstance(data, dict) and 'requestId' in data:
                    error_response["requestId"] = data["requestId"]
            except:
                pass
            print(json.dumps(error_response))
            sys.stdout.flush()

if __name__ == "__main__":
    main()
