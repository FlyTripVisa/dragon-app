(() => {
  "use strict";

  const chatForm = document.getElementById("chatForm");
  const messageInput = document.getElementById("messageInput");
  const sendButton = document.getElementById("sendButton");
  const messages = document.getElementById("messages");
  const chatArea = document.getElementById("chatArea");
  const welcome = document.getElementById("welcome");
  const quickPrompts = document.getElementById("quickPrompts");
  const newChatButton = document.getElementById("newChatButton");

  const STORAGE_KEY = "flydragon-chat-history";

  let conversation = [];
  let isStreaming = false;

  /* =========================
     INITIALIZE
  ========================== */

  function init() {
    loadHistory();
    setupEvents();
    autoResize();

    if (conversation.length > 0) {
      hideWelcome();
      renderHistory();
    }
  }

  /* =========================
     EVENTS
  ========================== */

  function setupEvents() {
    if (!chatForm || !messageInput || !sendButton || !messages) {
      console.error("Fly AI: Required chat elements are missing.");
      return;
    }

    chatForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (isStreaming) return;

      const text = messageInput.value.trim();

      if (!text) return;

      await sendMessage(text);
    });

    messageInput.addEventListener("input", autoResize);

    messageInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();

        if (!isStreaming) {
          chatForm.requestSubmit();
        }
      }
    });

    if (newChatButton) {
      newChatButton.addEventListener("click", newChat);
    }

    document.querySelectorAll("[data-prompt]").forEach((button) => {
      button.addEventListener("click", () => {
        const prompt = button.dataset.prompt || "";

        messageInput.value = prompt;

        autoResize();

        messageInput.focus();
      });
    });
  }

  /* =========================
     SEND MESSAGE
  ========================== */

  async function sendMessage(text) {
    if (isStreaming) return;

    isStreaming = true;

    setLoading(true);

    hideWelcome();

    addMessage("user", text);

    conversation.push({
      role: "user",
      content: text,
    });

    saveHistory();

    messageInput.value = "";

    autoResize();

    const assistantMessage =
      createMessageElement("assistant");

    messages.appendChild(
      assistantMessage.container
    );

    const contentElement =
      assistantMessage.content;

    scrollToBottom();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        },

        body: JSON.stringify({
          messages: conversation,
        }),
      });

      if (!response.ok) {
        let errorMessage = "";

        try {
          const errorData = await response.json();

          errorMessage =
            errorData.message ||
            errorData.error ||
            "";
        } catch {
          errorMessage =
            await response.text().catch(() => "");
        }

        throw new Error(
          errorMessage ||
          `Request failed with status ${response.status}`
        );
      }

      if (!response.body) {
        throw new Error(
          "Streaming response is not available."
        );
      }

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder("utf-8");

      let buffer = "";

      let assistantText = "";

      while (true) {
        const { value, done } =
          await reader.read();

        if (done) break;

        buffer += decoder.decode(value, {
          stream: true,
        });

        const parsed =
          processSSEBuffer(buffer);

        buffer = parsed.remaining;

        for (const event of parsed.events) {
          const token =
            extractToken(event);

          if (token === null) {
            continue;
          }

          if (token === "[DONE]") {
            continue;
          }

          assistantText += token;

          contentElement.textContent =
            assistantText;

          scrollToBottom();
        }
      }

      /*
       * Flush decoder.
       */

      buffer += decoder.decode();

      if (buffer.trim()) {
        const finalEvents =
          processSSEBuffer(buffer);

        for (const event of finalEvents.events) {
          const token =
            extractToken(event);

          if (
            token !== null &&
            token !== "[DONE]"
          ) {
            assistantText += token;
          }
        }
      }

      /*
       * Empty response protection.
       */

      if (!assistantText.trim()) {
        assistantText =
          "I couldn't generate a response right now. Please try again.";
      }

      contentElement.textContent =
        assistantText;

      conversation.push({
        role: "assistant",
        content: assistantText,
      });

      saveHistory();

      scrollToBottom();

    } catch (error) {
      console.error(
        "Fly 🐉 AI error:",
        error
      );

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Something went wrong.";

      contentElement.textContent =
        `Sorry, I couldn't process your request.\n\n${errorMessage}`;

    } finally {
      isStreaming = false;

      setLoading(false);

      messageInput.focus();
    }
  }

  /* =========================
     SSE PARSER
  ========================== */

  function processSSEBuffer(buffer) {
    const events = [];

    /*
     * Normalize Windows line endings.
     */

    const normalized =
      buffer.replace(/\r\n/g, "\n");

    /*
     * SSE events are separated by
     * an empty line.
     */

    const chunks =
      normalized.split("\n\n");

    /*
     * Last chunk may be incomplete.
     */

    const remaining =
      chunks.pop() || "";

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;

      events.push(chunk);
    }

    return {
      events,
      remaining,
    };
  }

  /* =========================
     EXTRACT STREAM TOKEN
  ========================== */

  function extractToken(event) {
    const lines =
      event.split("\n");

    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataLines.push(
          line.slice(5).trimStart()
        );
      }
    }

    if (!dataLines.length) {
      return null;
    }

    const data =
      dataLines.join("\n");

    if (data === "[DONE]") {
      return "[DONE]";
    }

    /*
     * JSON response formats.
     */

    try {
      const parsed =
        JSON.parse(data);

      /*
       * data: "hello"
       */

      if (typeof parsed === "string") {
        return parsed;
      }

      /*
       * data: {
       *   response: "hello"
       * }
       */

      if (
        typeof parsed.response ===
        "string"
      ) {
        return parsed.response;
      }

      /*
       * data: {
       *   text: "hello"
       * }
       */

      if (
        typeof parsed.text ===
        "string"
      ) {
        return parsed.text;
      }

      /*
       * data: {
       *   content: "hello"
       * }
       */

      if (
        typeof parsed.content ===
        "string"
      ) {
        return parsed.content;
      }

      /*
       * data: {
       *   token: "hello"
       * }
       */

      if (
        typeof parsed.token ===
        "string"
      ) {
        return parsed.token;
      }

      /*
       * Nested response object.
       */

      if (
        parsed.response &&
        typeof parsed.response ===
          "object" &&
        typeof parsed.response.text ===
          "string"
      ) {
        return parsed.response.text;
      }

      /*
       * OpenAI-style choices.
       */

      if (
        Array.isArray(parsed.choices) &&
        parsed.choices.length > 0
      ) {
        const choice =
          parsed.choices[0];

        if (
          choice.delta &&
          typeof choice.delta.content ===
            "string"
        ) {
          return choice.delta.content;
        }

        if (
          choice.message &&
          typeof choice.message.content ===
            "string"
        ) {
          return choice.message.content;
        }

        if (
          typeof choice.text ===
            "string"
        ) {
          return choice.text;
        }
      }

      return null;

    } catch {
      /*
       * Plain-text SSE:
       *
       * data: hello
       */

      return data;
    }
  }

  /* =========================
     MESSAGE UI
  ========================== */

  function addMessage(role, text) {
    const element =
      createMessageElement(role);

    element.content.textContent =
      text;

    messages.appendChild(
      element.container
    );

    scrollToBottom();
  }

  function createMessageElement(role) {
    const container =
      document.createElement("div");

    container.className =
      `message ${role}`;

    const avatar =
      document.createElement("div");

    avatar.className =
      "message-avatar";

    avatar.textContent =
      role === "assistant"
        ? "F"
        : "You";

    const content =
      document.createElement("div");

    content.className =
      "message-content";

    if (role === "assistant") {
      container.appendChild(avatar);
      container.appendChild(content);
    } else {
      container.appendChild(content);
      container.appendChild(avatar);
    }

    return {
      container,
      content,
    };
  }

  /* =========================
     HISTORY
  ========================== */

  function saveHistory() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(conversation)
      );
    } catch (error) {
      console.warn(
        "Could not save chat history:",
        error
      );
    }
  }

  function loadHistory() {
    try {
      const saved =
        localStorage.getItem(
          STORAGE_KEY
        );

      if (!saved) return;

      const parsed =
        JSON.parse(saved);

      if (!Array.isArray(parsed)) {
        return;
      }

      conversation =
        parsed.filter(
          (message) =>
            message &&
            (
              message.role === "user" ||
              message.role === "assistant"
            ) &&
            typeof message.content ===
              "string"
        );

    } catch (error) {
      console.warn(
        "Could not load chat history:",
        error
      );

      conversation = [];
    }
  }

  function renderHistory() {
    messages.innerHTML = "";

    for (const message of conversation) {
      addMessage(
        message.role,
        message.content
      );
    }
  }

  /* =========================
     NEW CHAT
  ========================== */

  function newChat() {
    if (isStreaming) return;

    conversation = [];

    try {
      localStorage.removeItem(
        STORAGE_KEY
      );
    } catch (error) {
      console.warn(
        "Could not clear chat history:",
        error
      );
    }

    messages.innerHTML = "";

    if (welcome) {
      welcome.classList.remove(
        "hidden"
      );
    }

    if (quickPrompts) {
      quickPrompts.classList.remove(
        "hidden"
      );
    }

    messageInput.value = "";

    autoResize();

    messageInput.focus();

    scrollToBottom();
  }

  /* =========================
     UI STATE
  ========================== */

  function hideWelcome() {
    if (welcome) {
      welcome.classList.add("hidden");
    }

    if (quickPrompts) {
      quickPrompts.classList.add(
        "hidden"
      );
    }
  }

  function setLoading(loading) {
    sendButton.disabled =
      loading;

    messageInput.disabled =
      loading;

    if (loading) {
      sendButton.setAttribute(
        "aria-busy",
        "true"
      );
    } else {
      sendButton.removeAttribute(
        "aria-busy"
      );
    }
  }

  function autoResize() {
    if (!messageInput) return;

    messageInput.style.height =
      "auto";

    const height =
      Math.min(
        messageInput.scrollHeight,
        140
      );

    messageInput.style.height =
      `${height}px`;
  }

  function scrollToBottom() {
    if (!chatArea) return;

    requestAnimationFrame(() => {
      chatArea.scrollTop =
        chatArea.scrollHeight;
    });
  }

  /* =========================
     START
  ========================== */

  init();

})();
