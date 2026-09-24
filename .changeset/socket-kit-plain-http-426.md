---
"@iskra-bun/socket-kit": patch
---

A request to the socket port that is not a WebSocket handshake (a plain `GET` from a browser or a load balancer's health check) gets `426 Upgrade Required` with `Upgrade: websocket`, instead of `500 Upgrade failed`, which health checks read as the service being down.
