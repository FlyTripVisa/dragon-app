/**
 * ============================================================
 * FLYTRIPVISA
 * Fly 🐉 AI Assistant
 *
 * Real-time chat client
 * Cloudflare Workers AI
 * AI Gateway
 * SSE streaming
 * ============================================================
 */

(() => {
  "use strict";

  /* ==========================================================
     CONFIG
  ========================================================== */

  const API_ENDPOINT = "/api/chat";

  const STORAGE_KEY =
    "flydragon-chat-history";

  const MAX_HISTORY = 50;

  /* ==========================================================
     DOM
  ========================================================== */

  const chatArea =
    document.getElementById("chatArea");

  const messagesContainer =
    document.getElementById("messages");

  const welcome =
    document.getElementById("welcome");

  const quickPrompts =
    document.getElementById("quickPrompts");

  const chatForm =
    document.getElementById("chatForm");

  const messageInput =
    document.getElementById("messageInput");

  const sendButton =
    document.getElementById("sendButton");

  const newChatButton =
    document.getElementById("newChatButton");

  /* ==========================================================
     STATE
  ========================================================== */

  let messages = [];

  let isStreaming = false;

  let abortController = null;

  /* ==========================================================
     INITIALIZE
  ========================================================== */

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      loadHistory();

      setupEvents();

      autoResize();

      updateUI();
    }
  );

  /*
   * Because this script is loaded with defer,
   * DOMContentLoaded should still fire normally.
   * But initialize immediately as a fallback.
   */

  if (
    document.readyState ===
    "interactive" ||
    document.readyState ===
    "complete"
  ) {
    initialize();
  }

  let initialized = false;

  function initialize() {
    if (initialized) {
      return;
    }

    initialized = true;

    loadHistory();

    setupEvents();

    autoResize();

    updateUI();
  }

  /* ==========================================================
     EVENTS
  ========================================================== */

  function setupEvents() {

    /* --------------------------------------------------------
       Chat form
    -------------------------------------------------------- */

    if (chatForm) {
      chatForm.addEventListener(
        "submit",
        async (event) => {

          event.preventDefault();

          await sendMessage();
        }
      );
    }

    /* --------------------------------------------------------
       Enter to send
       Shift + Enter = newline
    -------------------------------------------------------- */

    if (messageInput) {

      messageInput.addEventListener(
        "keydown",
        (event) => {

          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.isComposing
          ) {

            event.preventDefault();

            if (!isStreaming) {
              sendMessage();
            }
          }
        }
      );

      messageInput.addEventListener(
        "input",
        () => {
          autoResize();
        }
      );
    }

    /* --------------------------------------------------------
       New chat
    -------------------------------------------------------- */

    if (newChatButton) {

      newChatButton.addEventListener(
        "click",
        () => {

          if (isStreaming) {
            stopStreaming();
          }

          startNewChat();
        }
      );
    }

    /* --------------------------------------------------------
       Quick prompts
    -------------------------------------------------------- */

    if (quickPrompts) {

      quickPrompts.addEventListener(
        "click",
        (event) => {

          const button =
            event.target.closest(
              "[data-prompt]"
            );

          if (!button) {
            return;
          }

          const prompt =
            button.getAttribute(
              "data-prompt"
            );

          if (!prompt) {
            return;
          }

          if (messageInput) {
            messageInput.value =
              prompt;

            autoResize();

            messageInput.focus();
          }

          sendMessage();
        }
      );
    }
  }

  /* ==========================================================
     SEND MESSAGE
  ========================================================== */

  async function sendMessage() {

    if (isStreaming) {
      return;
    }

    if (!messageInput) {
      return;
    }

    const text =
      messageInput.value.trim();

    if (!text) {
      return;
    }

    /* --------------------------------------------------------
       User message
    -------------------------------------------------------- */

    const userMessage = {
      role: "user",
      content: text
    };

    messages.push(userMessage);

    saveHistory();

    renderMessage(
      userMessage
    );

    /* --------------------------------------------------------
       Clear input
    -------------------------------------------------------- */

    messageInput.value = "";

    autoResize();

    updateUI();

    /* --------------------------------------------------------
       Hide welcome
    -------------------------------------------------------- */

    hideWelcome();

    /* --------------------------------------------------------
       Assistant placeholder
    -------------------------------------------------------- */

    const assistantMessage = {
      role: "assistant",
      content: ""
    };

    messages.push(
      assistantMessage
    );

    const assistantElement =
      createAssistantMessageElement();

    /* --------------------------------------------------------
       Start streaming
    -------------------------------------------------------- */

    isStreaming = true;

    abortController =
      new AbortController();

    updateUI();

    try {

      await streamChat(
        assistantElement,
        assistantMessage
      );

      saveHistory();

    } catch (error) {

      console.error(
        "[Fly AI] Chat error:",
        error
      );

      /*
       * Remove empty assistant placeholder
       * if the request failed before any output.
       */

      if (
        !assistantMessage.content
      ) {

        assistantElement
          ?.remove();

        messages =
          messages.filter(
            (message) =>
              message !==
              assistantMessage
          );

        showError(
          getErrorMessage(error)
        );

      } else {

        assistantMessage.content +=
          "\n\n⚠️ Connection interrupted.";

      }

      saveHistory();

    } finally {

      isStreaming = false;

      abortController = null;

      updateUI();

      scrollToBottom();
    }
  }

  /* ==========================================================
     STREAM CHAT
  ========================================================== */

  async function streamChat(
    assistantElement,
    assistantMessage
  ) {

    const response =
      await fetch(
        API_ENDPOINT,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Accept":
              "text/event-stream"
          },

          body: JSON.stringify({
            messages:
              messages
                .filter(
                  (message) =>
                    message.role ===
                      "user" ||
                    message.role ===
                      "assistant"
                )
                .map(
                  (message) => ({
                    role:
                      message.role,

                    content:
                      message.content
                  })
                )
          }),

          signal:
            abortController.signal
        }
      );

    /* --------------------------------------------------------
       HTTP errors
    -------------------------------------------------------- */

    if (!response.ok) {

      let errorMessage =
        `HTTP ${response.status}`;

      try {

        const data =
          await response.json();

        if (data?.message) {
          errorMessage =
            data.message;
        }

        if (data?.error) {
          errorMessage =
            data.error;
        }

      } catch (_) {}

      throw new Error(
        errorMessage
      );
    }

    if (!response.body) {

      throw new Error(
        "Streaming response body is unavailable."
      );
    }

    /* --------------------------------------------------------
       Create reader
    -------------------------------------------------------- */

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder(
        "utf-8"
      );

    let buffer = "";

    /* --------------------------------------------------------
       Read stream
    -------------------------------------------------------- */

    while (true) {

      const {
        value,
        done
      } =
        await reader.read();

      if (done) {
        break;
      }

      buffer +=
        decoder.decode(
          value,
          {
            stream: true
          }
        );

      /*
       * SSE events are separated by
       * a blank line.
       */

      const events =
        buffer.split(
          /\r?\n\r?\n/
        );

      /*
       * Keep incomplete event.
       */

      buffer =
        events.pop() || "";

      for (
        const event
        of events
      ) {

        processSSEEvent(
          event,
          assistantElement,
          assistantMessage
        );
      }

      scrollToBottom();
    }

    /*
     * Flush decoder.
     */

    buffer +=
      decoder.decode();

    if (buffer.trim()) {

      processSSEEvent(
        buffer,
        assistantElement,
        assistantMessage
      );
    }
  }

  /* ==========================================================
     PROCESS SSE
  ========================================================== */

  function processSSEEvent(
    event,
    assistantElement,
    assistantMessage
  ) {

    if (!event) {
      return;
    }

    const lines =
      event.split(
        /\r?\n/
      );

    let eventType =
      "message";

    const dataLines = [];

    for (
      const line
      of lines
    ) {

      if (
        line.startsWith(
          "event:"
        )
      ) {

        eventType =
          line
            .slice(6)
            .trim();

      } else if (
        line.startsWith(
          "data:"
        )
      ) {

        dataLines.push(
          line
            .slice(5)
            .trimStart()
        );
      }
    }

    if (
      dataLines.length === 0
    ) {
      return;
    }

    const data =
      dataLines.join("\n");

    /* --------------------------------------------------------
       DONE
    -------------------------------------------------------- */

    if (
      data === "[DONE]"
    ) {
      return;
    }

    /* --------------------------------------------------------
       Error event
    -------------------------------------------------------- */

    if (
      eventType === "error"
    ) {

      let message =
        "AI streaming error.";

      try {

        const parsed =
          JSON.parse(data);

        message =
          parsed.error ||
          parsed.message ||
          message;

      } catch (_) {

        if (data) {
          message = data;
        }
      }

      throw new Error(
        message
      );
    }

    /* --------------------------------------------------------
       Parse data
    -------------------------------------------------------- */

    const text =
      extractTextFromSSEData(
        data
      );

    if (!text) {
      return;
    }

    /* --------------------------------------------------------
       Append
    -------------------------------------------------------- */

    assistantMessage.content +=
      text;

    updateAssistantElement(
      assistantElement,
      assistantMessage.content
    );
  }

  /* ==========================================================
     EXTRACT TEXT
  ========================================================== */

  function extractTextFromSSEData(
    data
  ) {

    if (!data) {
      return "";
    }

    /*
     * Plain text
     */

    if (
      !data.startsWith("{") &&
      !data.startsWith("[")
    ) {
      return data;
    }

    /*
     * JSON
     */

    try {

      const parsed =
        JSON.parse(data);

      /*
       * Common Workers AI
       * streaming format.
       */

      if (
        typeof parsed ===
        "string"
      ) {
        return parsed;
      }

      if (
        typeof parsed.response ===
        "string"
      ) {
        return parsed.response;
      }

      if (
        typeof parsed.text ===
        "string"
      ) {
        return parsed.text;
      }

      if (
        typeof parsed.content ===
        "string"
      ) {
        return parsed.content;
      }

      /*
       * OpenAI-compatible format.
       */

      const delta =
        parsed
          ?.choices?.[0]
          ?.delta
          ?.content;

      if (
        typeof delta ===
        "string"
      ) {
        return delta;
      }

      const choiceText =
        parsed
          ?.choices?.[0]
          ?.text;

      if (
        typeof choiceText ===
        "string"
      ) {
        return choiceText;
      }

      return "";

    } catch (_) {

      /*
       * If a provider returns raw text
       * that happens to start with {,
       * don't crash the stream.
       */

      return data;
    }
  }

  /* ==========================================================
     CREATE ASSISTANT MESSAGE
  ========================================================== */

  function createAssistantMessageElement() {

    const wrapper =
      document.createElement(
        "article"
      );

    wrapper.className =
      "message assistant";

    const avatar =
      document.createElement(
        "div"
      );

    avatar.className =
      "message-avatar";

    avatar.textContent =
      "🐉";

    avatar.setAttribute(
      "aria-hidden",
      "true"
    );

    const content =
      document.createElement(
        "div"
      );

    content.className =
      "message-content";

    /*
     * Typing indicator while
     * waiting for first token.
     */

    content.innerHTML =
      createTypingIndicator();

    wrapper.appendChild(
      avatar
    );

    wrapper.appendChild(
      content
    );

    messagesContainer.appendChild(
      wrapper
    );

    scrollToBottom();

    return wrapper;
  }

  /* ==========================================================
     UPDATE ASSISTANT
  ========================================================== */

  function updateAssistantElement(
    element,
    text
  ) {

    if (!element) {
      return;
    }

    const content =
      element.querySelector(
        ".message-content"
      );

    if (!content) {
      return;
    }

    /*
     * We intentionally use textContent
     * instead of innerHTML.
     *
     * This prevents AI output from
     * injecting HTML/JS into the page.
     */

    content.textContent =
      text || "";

    /*
     * Preserve newlines.
     */

    content.style.whiteSpace =
      "pre-wrap";

    scrollToBottom();
  }

  /* ==========================================================
     RENDER USER MESSAGE
  ========================================================== */

  function renderMessage(
    message
  ) {

    if (
      !messagesContainer
    ) {
      return;
    }

    const wrapper =
      document.createElement(
        "article"
      );

    wrapper.className =
      `message ${message.role}`;

    const avatar =
      document.createElement(
        "div"
      );

    avatar.className =
      "message-avatar";

    avatar.textContent =
      message.role ===
      "user"
        ? "You"
        : "🐉";

    const content =
      document.createElement(
        "div"
      );

    content.className =
      "message-content";

    content.textContent =
      message.content;

    content.style.whiteSpace =
      "pre-wrap";

    wrapper.appendChild(
      avatar
    );

    wrapper.appendChild(
      content
    );

    messagesContainer.appendChild(
      wrapper
    );

    scrollToBottom();
  }

  /* ==========================================================
     RENDER ALL
  ========================================================== */

  function renderAllMessages() {

    if (
      !messagesContainer
    ) {
      return;
    }

    messagesContainer.innerHTML =
      "";

    for (
      const message
      of messages
    ) {

      if (
        !message.content
      ) {
        continue;
      }

      renderMessage(
        message
      );
    }
  }

  /* ==========================================================
     TYPING
  ========================================================== */

  function createTypingIndicator() {

    return `
      <div class="typing" aria-label="Fly AI is thinking">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `;
  }

  /* ==========================================================
     UI
  ========================================================== */

  function updateUI() {

    if (sendButton) {

      sendButton.disabled =
        isStreaming ||
        !messageInput ||
        !messageInput.value.trim();

    }

    if (messageInput) {

      messageInput.disabled =
        isStreaming;

    }

    /*
     * While streaming, the send button
     * becomes a stop button.
     */

    if (sendButton) {

      if (isStreaming) {

        sendButton.title =
          "Stop response";

        sendButton.setAttribute(
          "aria-label",
          "Stop response"
        );

        sendButton.innerHTML = `
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <rect
              x="7"
              y="7"
              width="10"
              height="10"
              rx="1"
            ></rect>
          </svg>
        `;

        /*
         * Enable stop button.
         */

        sendButton.disabled =
          false;

      } else {

        sendButton.title =
          "Send message";

        sendButton.setAttribute(
          "aria-label",
          "Send message"
        );

        sendButton.innerHTML = `
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"
            />
          </svg>
        `;

      }
    }
  }

  /* ==========================================================
     SEND BUTTON STOP
  ========================================================== */

  if (sendButton) {

    sendButton.addEventListener(
      "click",
      (event) => {

        if (!isStreaming) {
          return;
        }

        event.preventDefault();

        stopStreaming();
      }
    );
  }

  /* ==========================================================
     STOP STREAMING
  ========================================================== */

  function stopStreaming() {

    if (!isStreaming) {
      return;
    }

    try {

      abortController?.abort();

    } catch (_) {}

    isStreaming =
      false;

    abortController =
      null;

    saveHistory();

    updateUI();
  }

  /* ==========================================================
     NEW CHAT
  ========================================================== */

  function startNewChat() {

    messages = [];

    saveHistory();

    if (messagesContainer) {
      messagesContainer.innerHTML =
        "";
    }

    showWelcome();

    if (messageInput) {

      messageInput.value =
        "";

      messageInput.focus();

    }

    autoResize();

    updateUI();

    scrollToBottom();
  }

  /* ==========================================================
     WELCOME
  ========================================================== */

  function hideWelcome() {

    if (welcome) {
      welcome.classList.add(
        "hidden"
      );
    }

    if (quickPrompts) {
      quickPrompts.classList.add(
        "hidden"
      );
    }
  }

  function showWelcome() {

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
  }

  /* ==========================================================
     HISTORY
  ========================================================== */

  function saveHistory() {

    try {

      const trimmed =
        messages.slice(
          -MAX_HISTORY
        );

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          trimmed
        )
      );

    } catch (error) {

      console.warn(
        "[Fly AI] Could not save history:",
        error
      );
    }
  }

  function loadHistory() {

    try {

      const raw =
        localStorage.getItem(
          STORAGE_KEY
        );

      if (!raw) {
        return;
      }

      const stored =
        JSON.parse(raw);

      if (
        !Array.isArray(stored)
      ) {
        return;
      }

      messages =
        stored.filter(
          (message) =>
            message &&
            (
              message.role ===
                "user" ||
              message.role ===
                "assistant"
            ) &&
            typeof message.content ===
              "string" &&
            message.content.trim()
        );

      if (
        messages.length > 0
      ) {

        hideWelcome();

        renderAllMessages();

      } else {

        showWelcome();

      }

    } catch (error) {

      console.warn(
        "[Fly AI] Could not load history:",
        error
      );

      messages = [];

      showWelcome();
    }
  }

  /* ==========================================================
     ERROR
  ========================================================== */

  function showError(
    message
  ) {

    const wrapper =
      document.createElement(
        "article"
      );

    wrapper.className =
      "message assistant";

    const avatar =
      document.createElement(
        "div"
      );

    avatar.className =
      "message-avatar";

    avatar.textContent =
      "🐉";

    const content =
      document.createElement(
        "div"
      );

    content.className =
      "message-content";

    content.textContent =
      `⚠️ ${message}`;

    wrapper.appendChild(
      avatar
    );

    wrapper.appendChild(
      content
    );

    messagesContainer.appendChild(
      wrapper
    );

    scrollToBottom();
  }

  function getErrorMessage(
    error
  ) {

    if (
      error?.name ===
      "AbortError"
    ) {
      return "Response stopped.";
    }

    if (
      error instanceof Error &&
      error.message
    ) {
      return error.message;
    }

    return "Unable to connect to Fly Dragon AI.";
  }

  /* ==========================================================
     TEXTAREA AUTO RESIZE
  ========================================================== */

  function autoResize() {

    if (!messageInput) {
      return;
    }

    messageInput.style.height =
      "auto";

    const height =
      Math.min(
        messageInput.scrollHeight,
        140
      );

    messageInput.style.height =
      `${height}px`;

    updateUI();
  }

  /* ==========================================================
     SCROLL
  ========================================================== */

  function scrollToBottom() {

    if (!chatArea) {
      return;
    }

    requestAnimationFrame(
      () => {

        chatArea.scrollTo({
          top:
            chatArea.scrollHeight,

          behavior:
            "smooth"
        });

      }
    );
  }

})();