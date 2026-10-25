import net from "node:net";
import { assertPreviewEnvironment, PREVIEW_DATABASE_SENTINEL } from "./jarvis-preview-evaluation-common.mjs";

assertPreviewEnvironment(process.env);
if (process.env.JARVIS_PREVIEW_EVALUATION !== "1" || process.env.DATABASE_URL !== PREVIEW_DATABASE_SENTINEL || process.env.DIRECT_URL !== PREVIEW_DATABASE_SENTINEL) throw new Error("PREVIEW_DATABASE_GUARD_REQUIRED");

const localHosts = new Set(["127.0.0.1", "::1", "localhost"]);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const value = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof value === "object" && value !== null ? value.host ?? "localhost" : typeof value === "number" ? typeof args[1] === "string" ? args[1] : "localhost" : null;
  const port = typeof value === "object" && value !== null ? Number(value.port) : typeof value === "number" ? value : null;
  if (typeof host !== "string" || !Number.isInteger(port) || port < 1 || port > 65535 || !(localHosts.has(host) || host === "api.openai.com" && port === 443)) throw new Error("PREVIEW_NETWORK_TARGET_REJECTED");
  return Reflect.apply(connect, this, args);
};
const fetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.protocol !== "https:" || url.hostname !== "api.openai.com" || url.port && url.port !== "443" || !["/v1/responses", "/v1/responses/input_tokens"].includes(url.pathname) || (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() !== "POST") throw new Error("PREVIEW_PROVIDER_ENDPOINT_REJECTED");
  return fetch(input, init);
};
