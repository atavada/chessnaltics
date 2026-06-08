(function initExtensionApi(global) {
  const api = global.chrome;

  if (!api) {
    throw new Error("Chrome extension API not found.");
  }

  function wrapMethod(context, methodName) {
    if (!context || typeof context[methodName] !== "function") {
      return () =>
        Promise.reject(
          new Error(`Extension API method unavailable: ${methodName}`)
        );
    }

    const method = context[methodName];

    return (...args) =>
      new Promise((resolve, reject) => {
        try {
          method.call(context, ...args, (result) => {
            const error = global.chrome?.runtime?.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }

            resolve(result);
          });
        } catch (error) {
          reject(error);
        }
      });
  }

  global.extensionAPI = {
    raw: api,
    runtime: {
      getURL: api.runtime.getURL.bind(api.runtime),
      onMessage: api.runtime.onMessage,
      sendMessage: wrapMethod(api.runtime, "sendMessage"),
    },
    storage: {
      local: {
        get: wrapMethod(api.storage.local, "get"),
        set: wrapMethod(api.storage.local, "set"),
      },
    },
    tabs: {
      query: wrapMethod(api.tabs, "query"),
      sendMessage: wrapMethod(api.tabs, "sendMessage"),
    },
  };
})(globalThis);
