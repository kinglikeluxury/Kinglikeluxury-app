import { createServer } from "node:http";

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("diagnostic_invalid_port");
  process.exit(2);
}

const server = createServer((_request, response) => {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end("diagnostic-listener-ok\n");
});

server.on("error", (error) => {
  const code = error && typeof error.code === "string" ? error.code : "unknown";
  console.error(`diagnostic_listener_error=${code}`);
  process.exitCode = 1;
});

server.listen(port, "0.0.0.0", () => {
  console.log("diagnostic_listener_started");
});
