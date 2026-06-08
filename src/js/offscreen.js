const analyzer = new StockfishAnalyzer(
  chrome.runtime.getURL("stockfish/stockfish.js")
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") {
    return undefined;
  }

  if (message.action === "ping") {
    sendResponse({ ok: true });
    return undefined;
  }

  if (message.action !== "analyzeBoard") {
    return undefined;
  }

  analyzer
    .analyzeFen(message.fen, message.depth)
    .then((pvs) => {
      sendResponse({ pvs });
    })
    .catch((error) => {
      console.error("Stockfish analysis error:", error);
      sendResponse({ error: error.message });
    });

  return true;
});
