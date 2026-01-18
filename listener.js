const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const statusEl = document.getElementById("listenerStatus");
let recognition;
let isListening = false;
let shouldListen = true;

function notifyStatus(status) {
  chrome.runtime.sendMessage({ type: "voice-status", status });
  if (!statusEl) {
    return;
  }
  if (status === "listening") {
    statusEl.textContent = "Listening…";
    return;
  }
  if (status && status.startsWith("error:")) {
    statusEl.textContent = `Error: ${status.replace("error:", "")}`;
    return;
  }
  if (status === "unsupported") {
    statusEl.textContent = "Speech recognition not supported.";
    return;
  }
  statusEl.textContent = "Stopped";
}

function initRecognition() {
  if (!SpeechRecognition) {
    notifyStatus("unsupported");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    isListening = true;
    notifyStatus("listening");
  };

  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const transcript = result[0].transcript.trim();
    chrome.runtime.sendMessage({ type: "voice-transcript", transcript });
    if (result.isFinal) {
      chrome.runtime.sendMessage({ type: "voice-command", command: transcript });
    }
  };

  recognition.onerror = (event) => {
    notifyStatus(`error:${event.error}`);
  };

  recognition.onend = () => {
    isListening = false;
    if (shouldListen) {
      recognition.start();
    } else {
      notifyStatus("stopped");
    }
  };
}

function startListening() {
  if (!recognition) {
    initRecognition();
  }
  if (!recognition || isListening) {
    return;
  }

  shouldListen = true;
  recognition.start();
}

function stopListening() {
  shouldListen = false;
  if (!recognition || !isListening) {
    return;
  }
  recognition.stop();
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) {
    return;
  }
  if (message.type === "voice-start") {
    startListening();
  }
  if (message.type === "voice-stop") {
    stopListening();
  }
});

startListening();
