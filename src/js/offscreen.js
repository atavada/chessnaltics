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

  (async () => {
    try {
      const pvs = await analyzer.analyzeFen(message.fen, message.depth, message.multiPv);
      sendResponse({ pvs });
    } catch (error) {
      console.error("Stockfish analysis error:", error);
      sendResponse({ error: error.message });
    }
  })();

  return true;
});
