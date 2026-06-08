function isChessTab(url) {
	return /^https?:\/\/(www\.)?chess\.com\//i.test(url || "");
}

function isMissingReceiverError(error) {
	const message = error?.message || String(error || "");
	return message.includes("Receiving end does not exist") || message.includes("Could not establish connection");
}

async function ensureContentScriptInjected(tab) {
	if (!tab?.id || !isChessTab(tab.url) || !extensionAPI.raw?.scripting) {
		return false;
	}

	await extensionAPI.raw.scripting.executeScript({
		target: { tabId: tab.id },
		files: ["js/extension-api.js", "js/content.js"],
	});

	return true;
}

async function sendMessageToTab(tab, message) {
	try {
		return await extensionAPI.tabs.sendMessage(tab.id, message);
	} catch (error) {
		if (!isMissingReceiverError(error)) {
			throw error;
		}

		const injected = await ensureContentScriptInjected(tab);
		if (!injected) {
			throw error;
		}

		return extensionAPI.tabs.sendMessage(tab.id, message);
	}
}

async function getActiveChessTab() {
	const tabs = await extensionAPI.tabs.query({
		active: true,
		currentWindow: true,
	});
	return tabs[0];
}

document.addEventListener("DOMContentLoaded", async () => {
	try {
		// Load all preferences
		const result = await extensionAPI.storage.local.get([
			"autoAnalyzeEnabled",
			"analysisDepth",
			"highlightStyle",
			"multiPvCount",
		]);

		// --- Depth slider ---
		const depthSlider = document.getElementById("depthSlider");
		const depthValue = document.getElementById("depthValue");
		const savedDepth = result.analysisDepth || 14;

		depthSlider.value = savedDepth;
		depthValue.textContent = savedDepth;

		// --- Highlight style dropdown ---
		const highlightSelect = document.getElementById("highlightStyle");
		const savedStyle = result.highlightStyle || "filled";
		highlightSelect.value = savedStyle;

		// --- MultiPV count dropdown ---
		const multiPvSelect = document.getElementById("multiPvCount");
		const savedPvCount = result.multiPvCount || 3;
		multiPvSelect.value = savedPvCount;

		// --- Analyze button state ---
		const analyzeButton = document.getElementById("analyze");
		analyzeButton.classList.toggle("active", result.autoAnalyzeEnabled || false);
		analyzeButton.textContent = result.autoAnalyzeEnabled ? "Deactivate" : "Activate";

		// === Event Handlers ===

		// Depth slider change
		depthSlider.addEventListener("input", async () => {
			const newDepth = parseInt(depthSlider.value, 10);
			depthValue.textContent = newDepth;

			await extensionAPI.storage.local.set({ analysisDepth: newDepth });

			const state = await extensionAPI.storage.local.get("autoAnalyzeEnabled");
			if (state.autoAnalyzeEnabled) {
				const tab = await getActiveChessTab();
				await sendMessageToTab(tab, {
					action: "depthChanged",
					depth: newDepth,
				});
			}
		});

		// Highlight style change
		highlightSelect.addEventListener("change", async () => {
			const newStyle = highlightSelect.value;
			await extensionAPI.storage.local.set({ highlightStyle: newStyle });

			const state = await extensionAPI.storage.local.get("autoAnalyzeEnabled");
			if (state.autoAnalyzeEnabled) {
				const tab = await getActiveChessTab();
				await sendMessageToTab(tab, {
					action: "highlightStyleChanged",
					style: newStyle,
				});
			}
		});

		// MultiPV count change
		multiPvSelect.addEventListener("change", async () => {
			const newCount = parseInt(multiPvSelect.value, 10);
			await extensionAPI.storage.local.set({ multiPvCount: newCount });

			const state = await extensionAPI.storage.local.get("autoAnalyzeEnabled");
			if (state.autoAnalyzeEnabled) {
				const tab = await getActiveChessTab();
				await sendMessageToTab(tab, {
					action: "multiPvChanged",
					count: newCount,
				});
			}
		});
	} catch (error) {
		console.error("Error loading preferences:", error);
	}
});

// Analyze button toggle
document.getElementById("analyze").addEventListener("click", async () => {
	try {
		const activeTab = await getActiveChessTab();

		const result = await extensionAPI.storage.local.get("autoAnalyzeEnabled");
		const newState = !result.autoAnalyzeEnabled;
		await extensionAPI.storage.local.set({ autoAnalyzeEnabled: newState });

		const button = document.getElementById("analyze");
		button.classList.toggle("active", newState);
		button.textContent = newState ? "Deactivate" : "Activate";

		await sendMessageToTab(activeTab, {
			action: "toggleAutoAnalyze",
			enabled: newState,
		});
	} catch (error) {
		console.error("Error:", error);
	}
});

// Reload extension button
document.getElementById("reloadExtension").addEventListener("click", () => {
	extensionAPI.runtime.reload();
});
