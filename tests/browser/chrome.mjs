import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export async function waitFor(predicate, description, milliseconds = 10_000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    const result = await predicate();
    if (result) return result;
    await delay(35);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

// A pipe keeps DevTools local to this test process and supports unpacked extensions.
export function launchChrome(profile) {
  const chrome = spawn(process.env.CHROME_BIN || "google-chrome", [
    "--headless",
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });

  const request = chrome.stdio[3];
  const reply = chrome.stdio[4];
  const closed = new Promise(resolve => chrome.once("close", resolve));
  const pending = new Map();
  const issues = [];
  let nextId = 0;
  let failure;
  let stderr = "";
  let messages = "";

  chrome.stderr.on("data", data => { stderr = (stderr + data).slice(-6000); });

  function disconnect(error) {
    failure = error;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  }

  chrome.on("error", disconnect);
  request.on("error", disconnect);
  reply.on("error", disconnect);
  chrome.on("exit", (code, signal) => disconnect(new Error(`Chrome exited (${code ?? signal}).\n${stderr}`)));

  reply.setEncoding("utf8");
  reply.on("data", data => {
    messages += data;
    for (let end; (end = messages.indexOf("\0")) >= 0;) {
      const message = JSON.parse(messages.slice(0, end));
      messages = messages.slice(end + 1);
      const call = pending.get(message.id);
      if (call) {
        pending.delete(message.id);
        if (message.error) call.reject(new Error(message.error.message));
        else call.resolve(message.result);
      } else if (message.method === "Runtime.exceptionThrown") {
        const detail = message.params.exceptionDetails;
        issues.push(detail.exception?.description ?? detail.text);
      } else if (message.method === "Log.entryAdded" && message.params.entry.source === "security") {
        issues.push(message.params.entry.text);
      }
    }
  });

  function send(method, params = {}, sessionId) {
    if (failure) return Promise.reject(failure);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chrome did not answer ${method}.\n${stderr}`));
      }, 10_000);
      pending.set(id, {
        resolve(value) { clearTimeout(timer); resolve(value); },
        reject(error) { clearTimeout(timer); reject(error); },
      });
      request.write(JSON.stringify({ id, method, params, sessionId }) + "\0");
    });
  }

  async function attach(targetId) {
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const command = (method, params) => send(method, params, sessionId);
    await Promise.all([command("Runtime.enable"), command("Log.enable")]);
    return {
      command,
      async evaluate(expression) {
        const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        }
        return result.result.value;
      },
    };
  }

  return {
    send,
    attach,
    issues,
    async close() {
      if (failure) chrome.kill();
      else await send("Browser.close").catch(() => chrome.kill());
      await closed;
    },
  };
}
