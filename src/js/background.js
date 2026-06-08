const OFFSCREEN_DOCUMENT_PATH = "pub/offscreen.html";
let offscreenDocumentPromise = null;
let offscreenDocumentReady = false;

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(response);
    });
  });
}

async function ensureOffscreenDocument() {
  const offscreenDocumentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenDocumentUrl],
    });

    if (existingContexts.length > 0) {
      offscreenDocumentReady = true;
      return;
    }
  }

  if (offscreenDocumentReady) {
    return;
  }

  if (offscreenDocumentPromise) {
    return offscreenDocumentPromise;
  }

  offscreenDocumentPromise = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["WORKERS"],
      justification: "Run Stockfish analysis in an offscreen document.",
    })
    .then(() => {
      offscreenDocumentReady = true;
    })
    .finally(() => {
      offscreenDocumentPromise = null;
    });

  return offscreenDocumentPromise;
}

async function ensureOffscreenReceiver() {
  await ensureOffscreenDocument();
  await sendRuntimeMessage({
    target: "offscreen",
    action: "ping",
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "offscreen" || message?.action !== "analyzeBoard") {
    return undefined;
  }

  ensureOffscreenReceiver()
    .then(() =>
      sendRuntimeMessage({
        target: "offscreen",
        action: "analyzeBoard",
        fen: message.fen,
        depth: message.depth,
      })
    )
    .then((response) => {
      sendResponse(response);
    })
    .catch((error) => {
      console.error("Offscreen analysis error:", error);
      sendResponse({ error: error.message });
    });

  return true;
});
