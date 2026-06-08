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

document.addEventListener("DOMContentLoaded", async () => {
	try {
		// Load preferences
		const result = await extensionAPI.storage.local.get(["autoAnalyzeEnabled", "analysisDepth"]);

		// Set depth slider
		const depthSlider = document.getElementById("depthSlider");
		const depthValue = document.getElementById("depthValue");
		const savedDepth = result.analysisDepth || 14;

		depthSlider.value = savedDepth;
		depthValue.textContent = savedDepth;

		// Set button state
		const analyzeButton = document.getElementById("analyze");
		analyzeButton.classList.toggle("active", result.autoAnalyzeEnabled || false);
		analyzeButton.textContent = result.autoAnalyzeEnabled ? "Deactivate" : "Activate";

		// Depth slider change handler
		depthSlider.addEventListener("input", async () => {
			const newDepth = parseInt(depthSlider.value, 10);
			depthValue.textContent = newDepth;

			await extensionAPI.storage.local.set({ analysisDepth: newDepth });
			console.log("Depth preference saved:", newDepth);

			// If auto-analyze is enabled, notify content script
			const state = await extensionAPI.storage.local.get("autoAnalyzeEnabled");
			if (state.autoAnalyzeEnabled) {
				const tabs = await extensionAPI.tabs.query({
					active: true,
					currentWindow: true,
				});
				await sendMessageToTab(tabs[0], {
					action: "depthChanged",
					depth: newDepth,
				});
			}
		});
	} catch (error) {
		console.error("Error loading preferences:", error);
	}
});

document.getElementById("analyze").addEventListener("click", async () => {
	try {
		const tabs = await extensionAPI.tabs.query({
			active: true,
			currentWindow: true,
		});
		const activeTab = tabs[0];

		// Toggle auto-analyze state
		const result = await extensionAPI.storage.local.get("autoAnalyzeEnabled");
		const newState = !result.autoAnalyzeEnabled;
		await extensionAPI.storage.local.set({ autoAnalyzeEnabled: newState });

		// Update button appearance
		const button = document.getElementById("analyze");
		button.classList.toggle("active", newState);
		button.textContent = newState ? "Deactivate" : "Activate";

		// Notify content script
		await sendMessageToTab(activeTab, {
			action: "toggleAutoAnalyze",
			enabled: newState,
		});
	} catch (error) {
		console.error("Error:", error);
	}
});
