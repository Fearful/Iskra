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

def reply(response):
    print(json.dumps(response))
    sys.stdout.flush()

def main():
    # El servidor no manda pedidos hasta ver esta linea (ver src/processor.ts).
    reply({"type": "status", "msg": "Python processor started"})

    for line in sys.stdin:
        request_id = None
        try:
            line = line.strip()
            if not line:
                continue

            data = json.loads(line)
            request_id = data.pop("requestId", None)
            deadline = data.pop("deadline", None)

            # Un pedido que ya vencio no se procesa: el cliente HTTP ya recibio
            # un 504 y el trabajo solo demoraria a los que siguen en la cola.
            if isinstance(deadline, (int, float)) and time.time() * 1000 > deadline:
                reply({"type": "error", "msg": "expired", "requestId": request_id})
                continue

            response = {"type": "result", "data": process_data(data)}
            if request_id:
                response["requestId"] = request_id
            reply(response)
        except Exception as e:
            # Con el requestId el servidor contesta el pedido en el acto (antes
            # se perdia y el pedido esperaba el timeout).
            error_response = {"type": "error", "msg": str(e)}
            if request_id:
                error_response["requestId"] = request_id
            reply(error_response)

if __name__ == "__main__":
    main()
