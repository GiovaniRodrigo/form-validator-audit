const nativeBrowser = globalThis.browser;
const chromeApi = globalThis.chrome;

const callbackMethod = (api, method) => (...args) =>
  new Promise((resolve, reject) => {
    api[method](...args, (result) => {
      const error = chromeApi?.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });

const chromeBrowser = {
  runtime: {
    getURL: chromeApi.runtime.getURL.bind(chromeApi.runtime),
    sendMessage: callbackMethod(chromeApi.runtime, "sendMessage"),
    onMessage: {
      addListener(listener) {
        chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
          Promise.resolve(listener(message, sender))
            .then(sendResponse)
            .catch((error) => sendResponse({ ok: false, error: error.message }));
          return true;
        });
      }
    }
  },
  tabs: {
    create: callbackMethod(chromeApi.tabs, "create"),
    query: callbackMethod(chromeApi.tabs, "query"),
    remove: callbackMethod(chromeApi.tabs, "remove"),
    onUpdated: chromeApi.tabs.onUpdated
  },
  storage: {
    local: {
      get: callbackMethod(chromeApi.storage.local, "get"),
      set: callbackMethod(chromeApi.storage.local, "set")
    }
  },
  scripting: {
    executeScript: callbackMethod(chromeApi.scripting, "executeScript")
  },
  debugger: chromeApi.debugger && {
    attach: callbackMethod(chromeApi.debugger, "attach"),
    detach: callbackMethod(chromeApi.debugger, "detach"),
    sendCommand: callbackMethod(chromeApi.debugger, "sendCommand")
  }
};

export default nativeBrowser || chromeBrowser;
