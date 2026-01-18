const SpeechRecognition = self.SpeechRecognition || self.webkitSpeechRecognition;
let recognition;
let isListening = false;
let shouldListen = false;
let micStream = null;

function notifyStatus(status) {
  chrome.runtime.sendMessage({ type: "voice-status", status });
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

async function ensureMicAccess() {
  if (micStream) {
    return true;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return true;
  } catch (error) {
    notifyStatus(`error:${error.name || "mic denied"}`);
    return false;
  }
}

async function startListening() {
  if (!recognition) {
    initRecognition();
  }
  if (!recognition || isListening) {
    return;
  }

  const allowed = await ensureMicAccess();
  if (!allowed) {
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

initRecognition();
