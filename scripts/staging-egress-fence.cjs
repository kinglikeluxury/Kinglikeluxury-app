const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

let blockedAttempts = 0;
const servers = new Set();

function isLoopback(host) {
  const value = String(host || "").replace(/^\[|\]$/g, "").toLowerCase();
  // Unix-domain sockets never leave the local host; tsx uses one for its
  // parent-process IPC during --import startup.
  return value.startsWith("/") || value.startsWith("\\\\.\\pipe\\") ||
    value === "localhost" || value === "::1" || value === "127.0.0.1" || value.startsWith("127.");
}

function hostFrom(input, options) {
  if (typeof input === "string" || input instanceof URL) {
    try { return new URL(input).hostname; } catch {}
  }
  if (input && typeof input === "object" && input.hostname) return input.hostname;
  if (options && typeof options === "object") return options.hostname || options.host;
  return typeof input === "object" && input ? input.host : input;
}

function denyIfPublic(host, channel) {
  if (isLoopback(host)) return;
  blockedAttempts += 1;
  const callsite = new Error().stack
    ?.split("\n")
    .slice(2, 7)
    .map(line => line.trim().replace(/\([^)]*\)/g, "(<path>)"))
    .join(" <- ");
  console.error(`[EGRESS_FENCE] blocked non-loopback ${channel} request; callsite=${callsite || "unavailable"}`);
  throw new Error("STAGING_TEST_EGRESS_BLOCKED");
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  denyIfPublic(hostFrom(input), "fetch");
  return originalFetch(input, init);
};

for (const transport of [http, https]) {
  const request = transport.request;
  transport.request = function patchedRequest(input, options, callback) {
    denyIfPublic(hostFrom(input, options), "http");
    return request.call(this, input, options, callback);
  };
  const get = transport.get;
  transport.get = function patchedGet(input, options, callback) {
    denyIfPublic(hostFrom(input, options), "http");
    return get.call(this, input, options, callback);
  };
}

const originalConnect = net.connect;
net.connect = function patchedConnect(options, ...args) {
  denyIfPublic(hostFrom(options), "socket");
  return originalConnect.call(this, options, ...args);
};

const originalCreateConnection = net.createConnection;
net.createConnection = function patchedCreateConnection(options, ...args) {
  denyIfPublic(hostFrom(options), "socket");
  return originalCreateConnection.call(this, options, ...args);
};

const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function patchedListen(...args) {
  servers.add(this);
  return originalListen.apply(this, args);
};

process.once("SIGTERM", () => {
  const closing = [...servers].map(server => new Promise(resolve => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  }));
  Promise.all(closing).finally(() => process.exit(0));
});

process.on("exit", () => {
  console.log(`[EGRESS_FENCE] blocked_attempts=${blockedAttempts}`);
});
