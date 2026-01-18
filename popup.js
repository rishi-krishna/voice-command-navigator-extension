const statusDot = document.getElementById("statusDot");
const statusTitle = document.getElementById("statusTitle");
const statusSubtitle = document.getElementById("statusSubtitle");
const transcriptText = document.getElementById("transcriptText");
const alwaysToggle = document.getElementById("alwaysToggle");
const dictationToggle = document.getElementById("dictationToggle");

function setStatus(status) {
  if (status === "listening") {
    statusDot.style.background = "var(--success)";
    statusDot.style.boxShadow = "0 0 0 4px rgba(34, 197, 94, 0.2)";
    statusTitle.textContent = "Listening...";
    statusSubtitle.textContent = "Say a command anytime.";
    return;
  }

  if (status && status.startsWith("error:")) {
    statusDot.style.background = "var(--danger)";
    statusDot.style.boxShadow = "0 0 0 4px rgba(244, 63, 94, 0.2)";
    statusTitle.textContent = "Mic error";
    statusSubtitle.textContent = status.replace("error:", "");
    return;
  }

  if (status === "unsupported") {
    statusDot.style.background = "var(--danger)";
    statusDot.style.boxShadow = "0 0 0 4px rgba(244, 63, 94, 0.2)";
    statusTitle.textContent = "Not supported";
    statusSubtitle.textContent = "Speech recognition is unavailable in this browser.";
    return;
  }

  if (status && status.startsWith("unknown:")) {
    statusDot.style.background = "var(--danger)";
    statusDot.style.boxShadow = "0 0 0 4px rgba(244, 63, 94, 0.2)";
    statusTitle.textContent = "Unknown command";
    statusSubtitle.textContent = status.replace("unknown:", "");
    return;
  }

  if (status === "Dictation on" || status === "Dictation off") {
    statusDot.style.background = "var(--success)";
    statusDot.style.boxShadow = "0 0 0 4px rgba(34, 197, 94, 0.2)";
    statusTitle.textContent = status;
    statusSubtitle.textContent = "Voice shortcut applied.";
    return;
  }

  statusDot.style.background = "var(--danger)";
  statusDot.style.boxShadow = "0 0 0 4px rgba(244, 63, 94, 0.2)";
  statusTitle.textContent = "Mic off";
  statusSubtitle.textContent = "Toggle always-on to start listening.";
}

function updateTranscript(text) {
  transcriptText.textContent = text || "Waiting for your voice...";
}

function requestStatus() {
  chrome.runtime.sendMessage({ type: "request-status" }, (response) => {
    if (!response) {
      return;
    }
    alwaysToggle.checked = Boolean(response.enabled);
    dictationToggle.checked = Boolean(response.dictation);
    updateTranscript(response.transcript || "");
    setStatus(response.status || "stopped");
  });
}

alwaysToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({ type: "toggle-voice", enabled: alwaysToggle.checked });
  setStatus(alwaysToggle.checked ? "listening" : "stopped");
});

dictationToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({ type: "toggle-dictation", enabled: dictationToggle.checked });
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "ui-transcript") {
    updateTranscript(message.transcript || "");
  }

  if (message.type === "ui-status") {
    setStatus(message.status || "stopped");
  }
});

requestStatus();
