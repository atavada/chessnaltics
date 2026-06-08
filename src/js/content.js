let isAutoAnalyzeEnabled = false;
let moveObserver = null;
let previousHighlights = [];
let currentDepth = 14;
let currentHighlightStyle = "filled"; // "filled" | "outline" | "off"
let currentMultiPv = 3;
let lastPvs = null;
let lastBoardState = null;

// PV color scheme: 5 colors for up to 5 recommendations
const PV_COLORS = [
	{ bg: "rgba(59, 130, 246, 0.5)", border: "rgba(59, 130, 246, 0.85)", badge: "#3b82f6" },
	{ bg: "rgba(245, 158, 11, 0.5)", border: "rgba(245, 158, 11, 0.85)", badge: "#f59e0b" },
	{ bg: "rgba(255, 49, 49, 0.5)", border: "rgba(255, 49, 49, 0.85)", badge: "#ff4e4eff" },
	{ bg: "rgba(168, 85, 247, 0.5)", border: "rgba(168, 85, 247, 0.85)", badge: "#a855f7" },
	{ bg: "rgba(20, 184, 166, 0.5)", border: "rgba(20, 184, 166, 0.85)", badge: "#14b8a6" },
];

// Inject minimal CSS for badge styling
const PIECE_LABELS = { p: "P", n: "N", b: "B", r: "R", q: "Q", k: "K" };

const cheatStyles = document.createElement("style");
cheatStyles.textContent = `
  .cheat-score-badge {
    position: absolute;
    top: 2px;
    left: 2px;
    font-size: 10px;
    font-weight: 700;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #fff;
    padding: 1px 4px;
    border-radius: 3px;
    line-height: 1.3;
    pointer-events: none;
    z-index: 1;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  }
  .cheat-piece-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    font-size: 10px;
    font-weight: 700;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #fff;
    background-color: #404040;
    padding: 1px 4px;
    border-radius: 3px;
    line-height: 1.3;
    pointer-events: none;
    z-index: 1;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    border: 1px solid #666;
  }
`;
document.head.appendChild(cheatStyles);

// --- Auto-detect player color ---
function detectPlayerColor() {
	const board = document.querySelector("wc-chess-board");
	if (!board) return "white";
	return board.classList.contains("flipped") ? "black" : "white";
}

// --- Highlight & badge rendering ---
function clearHighlights() {
	previousHighlights.forEach((el) => el.remove());
	previousHighlights = [];
}

function getHighlightCss(colorScheme, style) {
	if (style === "outline") {
		return `border: 3px solid ${colorScheme.border}; background: transparent; box-sizing: border-box; z-index: 0; position: absolute;`;
	}
	// Default: filled
	return `background: ${colorScheme.bg}; z-index: 0; position: absolute;`;
}

function highlightBestMoves(pvs, boardState) {
	clearHighlights();

	// Save last state for re-rendering on style change
	lastPvs = pvs;
	lastBoardState = boardState;

	if (currentHighlightStyle === "off") return;
	if (!pvs || pvs.length === 0) return;

	const chessboard = document.querySelector("wc-chess-board");
	if (!chessboard) {
		console.error("Chessboard not found for highlighting.");
		return;
	}

	const charToNum = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };

	// --- Pass 1: Collect piece badge info grouped by target square ---
	const targetSquarePieces = new Map(); // toSquare -> [{label, colorScheme}]

	pvs.forEach((pv, index) => {
		const move = pv.move;
		if (!move || move.length < 4) return;

		const colorScheme = PV_COLORS[index] || PV_COLORS[PV_COLORS.length - 1];
		const toSquare = `${charToNum[move[2]]}${move[3]}`;

		if (boardState) {
			const fromCol = charToNum[move[0]] - 1;
			const fromRow = 8 - parseInt(move[1], 10);
			const piece = boardState[fromRow]?.[fromCol];
			if (piece && piece.length === 2) {
				const pieceLabel = PIECE_LABELS[piece[1].toLowerCase()];
				if (pieceLabel) {
					if (!targetSquarePieces.has(toSquare)) {
						targetSquarePieces.set(toSquare, []);
					}
					targetSquarePieces.get(toSquare).push({
						label: pieceLabel,
						badgeColor: colorScheme.badge,
					});
				}
			}
		}
	});

	// Track which target squares have already had their piece badge rendered
	const renderedPieceBadges = new Set();

	// --- Pass 2: Render overlays ---
	pvs.forEach((pv, index) => {
		const move = pv.move;
		if (!move || move.length < 4) return;

		const colorScheme = PV_COLORS[index] || PV_COLORS[PV_COLORS.length - 1];

		const fromSquare = `${charToNum[move[0]]}${move[1]}`;
		const toSquare = `${charToNum[move[2]]}${move[3]}`;

		// From-square highlight
		const fromHighlight = document.createElement("div");
		fromHighlight.className = `highlight cheat-highlight square-${fromSquare}`;
		fromHighlight.style.cssText = getHighlightCss(colorScheme, currentHighlightStyle);
		chessboard.appendChild(fromHighlight);
		previousHighlights.push(fromHighlight);

		// To-square highlight with score badge
		const toHighlight = document.createElement("div");
		toHighlight.className = `highlight cheat-highlight square-${toSquare}`;
		toHighlight.style.cssText = getHighlightCss(colorScheme, currentHighlightStyle);

		// Score badge (top-left) — always per-PV
		const scoreBadge = document.createElement("span");
		scoreBadge.className = "cheat-score-badge";
		scoreBadge.style.backgroundColor = colorScheme.badge;
		scoreBadge.textContent = pv.scoreText || "";
		toHighlight.appendChild(scoreBadge);

		// Combined piece badge (top-right) — render once per target square
		if (!renderedPieceBadges.has(toSquare) && targetSquarePieces.has(toSquare)) {
			renderedPieceBadges.add(toSquare);

			const entries = targetSquarePieces.get(toSquare);
			const pieceBadge = document.createElement("span");
			pieceBadge.className = "cheat-piece-badge";

			if (entries.length === 1) {
				// Single piece — simple text
				pieceBadge.textContent = entries[0].label;
			} else {
				// Multiple pieces — colored initials side by side
				entries.forEach((entry, i) => {
					const initial = document.createElement("span");
					initial.textContent = entry.label;
					initial.style.cssText = `
						color: #fff;
						background-color: ${entry.badgeColor};
						padding: 0 3px;
						border-radius: 2px;
						margin-left: ${i > 0 ? "2px" : "0"};
					`;
					pieceBadge.appendChild(initial);
				});
			}

			toHighlight.appendChild(pieceBadge);
		}

		chessboard.appendChild(toHighlight);
		previousHighlights.push(toHighlight);
	});
}

// --- Board state extraction ---
function getBoardState() {
	const pieces = document.querySelectorAll(".piece");
	const board = Array(8)
		.fill(null)
		.map(() => Array(8).fill(null));

	pieces.forEach((piece) => {
		const classList = piece.className;
		const match = classList.match(/square-(\d)(\d)/);
		if (match) {
			const row = 8 - parseInt(match[2], 10);
			const col = parseInt(match[1], 10) - 1;
			const typeMatch = classList.match(/\b[bw][pnbrqk]\b/);
			if (typeMatch) {
				board[row][col] = typeMatch[0];
			}
		}
	});
	return board;
}

function boardToFen(board, activeColor = "w") {
	let fen = board
		.map((row) =>
			row
				.map((cell) => {
					if (!cell) return "1";
					const piece = cell[1].toLowerCase();
					return cell[0] === "w" ? piece.toUpperCase() : piece;
				})
				.join("")
				.replace(/1+/g, (match) => match.length),
		)
		.join("/");

	const castlingRights = "KQkq";
	const enPassant = "-";
	const halfmoveClock = "0";
	const fullmoveNumber = "1";

	return `${fen} ${activeColor} ${castlingRights} ${enPassant} ${halfmoveClock} ${fullmoveNumber}`;
}

// --- Core analysis ---
function analyzeBoardState() {
	if (!isAutoAnalyzeEnabled) {
		clearHighlights();
		return;
	}

	const playerColor = detectPlayerColor();
	console.log("Auto-analyzing board state (color:", playerColor, ")...");

	const boardState = getBoardState();
	if (!boardState) return;

	const activeTurn = playerColor === "white" ? "w" : "b";
	const fen = boardToFen(boardState, activeTurn);

	// Validate turn
	const currentTurn = fen.split(" ")[1];
	if (currentTurn !== activeTurn) {
		console.log("Not player's turn");
		clearHighlights();
		return;
	}

	(async () => {
		try {
			const analysis = await extensionAPI.runtime.sendMessage({
				action: "analyzeBoard",
				fen: fen,
				depth: currentDepth,
				multiPv: currentMultiPv,
			});

			if (!isAutoAnalyzeEnabled) return;

			if (analysis && analysis.pvs && analysis.pvs.length > 0) {
				console.log("Received MultiPV analysis:", analysis.pvs);
				highlightBestMoves(analysis.pvs, boardState);
			} else {
				if (analysis && analysis.error) {
					console.error("Analysis error from engine:", analysis.error);
				}
				clearHighlights();
			}
		} catch (error) {
			console.error("Analysis error:", error);
			clearHighlights();
		}
	})();
}

// --- Move observer ---
function setupMoveObserver() {
	if (moveObserver) {
		moveObserver.disconnect();
	}

	const board = document.querySelector("wc-chess-board");
	if (!board) return;

	let lastMove = null;
	const debounceTime = 500;

	moveObserver = new MutationObserver((mutations) => {
		if (!isAutoAnalyzeEnabled) return;

		const now = Date.now();
		if (lastMove && now - lastMove < debounceTime) {
			return;
		}

		const playerColor = detectPlayerColor();

		for (const mutation of mutations) {
			if (
				mutation.type === "attributes" &&
				mutation.attributeName === "class" &&
				mutation.target.classList.contains("piece")
			) {
				const pieceClasses = mutation.target.className;
				const isWhitePiece = pieceClasses.includes("w");
				const isBlackPiece = pieceClasses.includes("b");

				// Only analyze after opponent's pieces move
				if ((playerColor === "white" && isBlackPiece) || (playerColor === "black" && isWhitePiece)) {
					lastMove = now;
					setTimeout(() => {
						if (isAutoAnalyzeEnabled) {
							analyzeBoardState();
						}
					}, 200);
					break;
				}
			}
		}
	});

	moveObserver.observe(board, {
		subtree: true,
		attributes: true,
		attributeFilter: ["class"],
	});
}

// --- Message listener ---
extensionAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
	console.log("Content script received message:", message);

	if (message.action === "toggleAutoAnalyze") {
		isAutoAnalyzeEnabled = message.enabled;
		if (isAutoAnalyzeEnabled) {
			// Load all preferences from storage before analyzing
			(async () => {
				try {
					const result = await extensionAPI.storage.local.get([
						"analysisDepth",
						"highlightStyle",
						"multiPvCount",
					]);
					currentDepth = result.analysisDepth || 14;
					currentHighlightStyle = result.highlightStyle || "filled";
					currentMultiPv = result.multiPvCount || 3;
					setupMoveObserver();
					analyzeBoardState();
				} catch (error) {
					console.error("Error loading preferences from storage:", error);
					// Fall back to defaults and proceed anyway
					setupMoveObserver();
					analyzeBoardState();
				}
			})();
		} else {
			if (moveObserver) {
				moveObserver.disconnect();
				moveObserver = null;
			}
			clearHighlights();
			lastPvs = null;
			lastBoardState = null;
		}
		return true;
	}

	if (message.action === "depthChanged") {
		currentDepth = message.depth || 14;
		if (isAutoAnalyzeEnabled) {
			analyzeBoardState();
		}
		return true;
	}

	if (message.action === "highlightStyleChanged") {
		currentHighlightStyle = message.style || "filled";
		// Re-render with existing data — no need to re-analyze
		if (lastPvs && lastBoardState) {
			highlightBestMoves(lastPvs, lastBoardState);
		} else if (currentHighlightStyle === "off") {
			clearHighlights();
		}
		return true;
	}

	if (message.action === "multiPvChanged") {
		currentMultiPv = message.count || 3;
		// Trigger re-analysis with new PV count
		if (isAutoAnalyzeEnabled) {
			analyzeBoardState();
		}
		return true;
	}
});
