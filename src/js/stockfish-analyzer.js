(function initStockfishAnalyzer(global) {
  class StockfishAnalyzer {
    constructor(workerScriptUrl) {
      this.workerScriptUrl = workerScriptUrl;
      this.worker = null;
      this.readyPromise = null;
      this.queue = [];
      this.currentTask = null;
      this.fenCache = new Map();
      this.readyTimeoutMs = 15000;
      this.analysisTimeoutMs = 30000;
      this.multiPvCount = 3;
      this.pendingPvs = [];
    }

    async analyzeFen(fen, depth, multiPv) {
      const pvCount = multiPv || this.multiPvCount;
      const cacheKey = `${fen}_d${depth || 18}_pv${pvCount}`;
      const cached = this.fenCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      await this.ensureReady();

      return new Promise((resolve, reject) => {
        this.queue.push({ fen, depth: depth || 18, multiPv: pvCount, resolve, reject });
        this.processQueue();
      });
    }

    async ensureReady() {
      if (this.readyPromise) {
        return this.readyPromise;
      }

      this.worker = new Worker(this.workerScriptUrl);

      this.readyPromise = new Promise((resolve, reject) => {
        let initialized = false;
        const timeoutId = global.setTimeout(() => {
          if (initialized) {
            return;
          }

          const error = new Error("Stockfish initialization timed out.");
          this.rejectAll(error);
          reject(error);
        }, this.readyTimeoutMs);

        this.worker.onmessage = (event) => {
          const line =
            typeof event.data === "string" ? event.data : String(event.data);

          if (!initialized && line === "uciok") {
            initialized = true;
            global.clearTimeout(timeoutId);
            this.worker.postMessage(
              `setoption name MultiPV value ${this.multiPvCount}`
            );
            this.worker.postMessage("ucinewgame");
            resolve();
            return;
          }

          this.handleWorkerMessage(line);
        };

        this.worker.onerror = (event) => {
          global.clearTimeout(timeoutId);
          const error = new Error(event.message || "Stockfish worker failed.");
          this.rejectAll(error);
          reject(error);
        };

        this.worker.postMessage("uci");
      });

      return this.readyPromise;
    }

    parseInfoLine(line) {
      const parts = line.split(" ");
      let multipv = null;
      let score = null;
      let move = null;

      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === "multipv" && i + 1 < parts.length) {
          multipv = parseInt(parts[i + 1], 10);
        }
        if (parts[i] === "score" && i + 2 < parts.length) {
          const scoreType = parts[i + 1];
          const scoreValue = parseInt(parts[i + 2], 10);
          if (scoreType === "cp") {
            score = { type: "cp", value: scoreValue };
          } else if (scoreType === "mate") {
            score = { type: "mate", value: scoreValue };
          }
        }
        if (parts[i] === "pv" && i + 1 < parts.length) {
          move = parts[i + 1];
        }
      }

      if (multipv !== null && score !== null && move !== null) {
        return { multipv, score, move };
      }

      return null;
    }

    formatScore(score) {
      if (score.type === "mate") {
        return `M${Math.abs(score.value)}`;
      }
      const pawns = (score.value / 100).toFixed(1);
      return score.value >= 0 ? `+${pawns}` : `${pawns}`;
    }

    handleWorkerMessage(line) {
      // Parse info lines with multipv data
      if (line.startsWith("info") && line.includes("multipv")) {
        const parsed = this.parseInfoLine(line);
        if (parsed) {
          // Replace or insert at the correct multipv index
          this.pendingPvs[parsed.multipv - 1] = {
            move: parsed.move,
            score: parsed.score,
            scoreText: this.formatScore(parsed.score),
            rank: parsed.multipv,
          };
        }
        return;
      }

      if (!line.startsWith("bestmove") || !this.currentTask) {
        return;
      }

      // Collect results and resolve
      const results = this.pendingPvs.filter(Boolean);
      this.pendingPvs = [];

      if (results.length === 0) {
        const bestMove = line.split(" ")[1];
        if (bestMove) {
          results.push({
            move: bestMove,
            score: { type: "cp", value: 0 },
            scoreText: "+0.0",
            rank: 1,
          });
        }
      }

      const cacheKey = `${this.currentTask.fen}_d${this.currentTask.depth}_pv${this.currentTask.multiPv}`;
      this.fenCache.set(cacheKey, results);
      global.clearTimeout(this.currentTask.timeoutId);
      this.currentTask.resolve(results);
      this.currentTask = null;
      this.processQueue();
    }

    processQueue() {
      if (!this.worker || this.currentTask || this.queue.length === 0) {
        return;
      }

      const nextTask = this.queue.shift();
      this.currentTask = nextTask;
      this.pendingPvs = [];
      this.currentTask.timeoutId = global.setTimeout(() => {
        const error = new Error("Stockfish analysis timed out.");
        this.rejectAll(error);
      }, this.analysisTimeoutMs);

      // Dynamically update MultiPV if count changed
      if (nextTask.multiPv && nextTask.multiPv !== this.multiPvCount) {
        this.multiPvCount = nextTask.multiPv;
        this.worker.postMessage(
          `setoption name MultiPV value ${this.multiPvCount}`
        );
      }

      this.worker.postMessage(`position fen ${nextTask.fen}`);
      this.worker.postMessage(`go depth ${nextTask.depth}`);
    }

    rejectAll(error) {
      if (this.currentTask) {
        global.clearTimeout(this.currentTask.timeoutId);
        this.currentTask.reject(error);
        this.currentTask = null;
      }

      while (this.queue.length > 0) {
        const queuedTask = this.queue.shift();
        queuedTask.reject(error);
      }

      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }

      this.readyPromise = null;
      this.pendingPvs = [];
    }
  }

  global.StockfishAnalyzer = StockfishAnalyzer;
})(globalThis);
