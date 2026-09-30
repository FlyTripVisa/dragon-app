(() => {
  "use strict";

  /*
   * ==========================================
   * FLYTRIPVISA
   * Fly 🐉 AI Assistant
   *
   * Frontend endpoint:
   * POST /api/chat
   * ==========================================
   */

  const API_ENDPOINT = "/api/chat";

  const STORAGE_KEY =
    "flydragon-chat-history";

  const chatForm =
    document.getElementById("chatForm");

  const messageInput =
    document.getElementById("messageInput");

  const sendButton =
    document.getElementById("sendButton");

  const messages =
    document.getElementById("messages");

  const chatArea =
    document.getElementById("chatArea");

  const welcome =
    document.getElementById("welcome");

  const quickPrompts =
    document.getElementById("quickPrompts");

  const newChatButton =
    document.getElementById("newChatButton");

  let conversation = [];

  let isStreaming = false;

  /*
   * ==========================================
   * INITIALIZE
   * ==========================================
   */

  function init() {
    loadHistory();

    setupEvents();

    autoResize();

    if (conversation.length > 0) {
      hideWelcome();

      renderHistory();
    }
  }

  /*
   * ==========================================
   * EVENTS
   * ==========================================
   */

  function setupEvents() {
    if (
      !chatForm ||
      !messageInput ||
      !sendButton ||
      !messages
    ) {
      console.error(
        "Fly AI: Required chat elements are missing."
      );

      return;
    }

    /*
     * Submit
     */

    chatForm.addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        if (isStreaming) {
          return;
        }

        const text =
          messageInput.value.trim();

        if (!text) {
          return;
        }

        await sendMessage(text);
      }
    );

    /*
     * Auto resize
     */

    messageInput.addEventListener(
      "input",
      autoResize
    );

    /*
     * Enter = send
     * Shift + Enter = new line
     */

    messageInput.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Enter" &&
          !event.shiftKey
        ) {
          event.preventDefault();

          if (!isStreaming) {
            chatForm.requestSubmit();
          }
        }
      }
    );

    /*
     * New chat
     */

    if (newChatButton) {
      newChatButton.addEventListener(
        "click",
        newChat
      );
    }

    /*
     * Quick prompts
     */

    document
      .querySelectorAll("[data-prompt]")
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            const prompt =
              button.dataset.prompt ||
              "";

            if (!prompt) {
              return;
            }

            messageInput.value =
              prompt;

            autoResize();

            messageInput.focus();
          }
        );
      });
  }

  /*
   * ==========================================
   * SEND MESSAGE
   * ==========================================
   */

  async function sendMessage(text) {
    if (isStreaming) {
      return;
    }

    isStreaming = true;

    setLoading(true);

    hideWelcome();

    /*
     * Add user message to UI
     */

    addMessage(
      "user",
      text
    );

    /*
     * Add user message to
     * conversation history
     */

    conversation.push({
      role: "user",
      content: text,
    });

    saveHistory();

    /*
     * Clear input
     */

    messageInput.value = "";

    autoResize();

    /*
     * Create empty assistant message
     */

    const assistantMessage =
      createMessageElement(
        "assistant"
      );

    messages.appendChild(
      assistantMessage.container
    );

    const contentElement =
      assistantMessage.content;

    scrollToBottom();

    try {
      /*
       * ======================================
       * POST /api/chat
       * ======================================
       *
       * AI Gateway is NOT called from here.
       *
       * Browser
       *   ↓
       * /api/chat
       *   ↓
       * Worker
       *   ↓
       * env.AI.run()
       *   ↓
       * AI Gateway
       *   ↓
       * Workers AI
       */

      const response =
        await fetch(
          API_ENDPOINT,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              "Accept":
                "text/event-stream",
            },

            body: JSON.stringify({
              messages:
                conversation,
            }),
          }
        );

      /*
       * HTTP error
       */

      if (!response.ok) {
        let errorMessage = "";

        try {
          const contentType =
            response.headers.get(
              "content-type"
            ) || "";

          if (
            contentType.includes(
              "application/json"
            )
          ) {
            const errorData =
              await response.json();

            errorMessage =
              errorData.message ||
              errorData.error ||
              "";
          } else {
            errorMessage =
              await response.text();
          }
        } catch {
          errorMessage = "";
        }

        throw new Error(
          errorMessage ||
            `Request failed with status ${response.status}`
        );
      }

      /*
       * Streaming support
       */

      if (!response.body) {
        throw new Error(
          "Streaming response is not available."
        );
      }

      /*
       * Read stream
       */

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder(
          "utf-8"
        );

      let buffer = "";

      let assistantText = "";

      /*
       * ======================================
       * STREAM LOOP
       * ======================================
       */

      while (true) {
        const {
          value,
          done,
        } = await reader.read();

        if (done) {
          break;
        }

        /*
         * Decode incoming bytes
         */

        buffer +=
          decoder.decode(
            value,
            {
              stream: true,
            }
          );

        /*
         * Parse SSE
         */

        const parsed =
          processSSEBuffer(
            buffer
          );

        buffer =
          parsed.remaining;

        /*
         * Process events
         */

        for (
          const event
          of parsed.events
        ) {
          const token =
            extractToken(
              event
            );

          if (
            token === null
          ) {
            continue;
          }

          if (
            token === "[DONE]"
          ) {
            continue;
          }

          /*
           * Append token
           */

          assistantText +=
            token;

          /*
           * Update UI
           */

          contentElement.textContent =
            assistantText;

          scrollToBottom();
        }
      }

      /*
       * Flush TextDecoder
       */

      buffer +=
        decoder.decode();

      /*
       * Process remaining SSE
       */

      if (buffer.trim()) {
        const finalParsed =
          processSSEBuffer(
            buffer
          );

        for (
          const event
          of finalParsed.events
        ) {
          const token =
            extractToken(
              event
            );

          if (
            token !== null &&
            token !== "[DONE]"
          ) {
            assistantText +=
              token;
          }
        }
      }

      /*
       * Empty response protection
       */

      if (
        !assistantText.trim()
      ) {
        assistantText =
          "I couldn't generate a response right now. Please try again.";
      }

      /*
       * Final UI update
       */

      contentElement.textContent =
        assistantText;

      /*
       * Save assistant response
       */

      conversation.push({
        role: "assistant",
        content:
          assistantText,
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

  /*
   * ==========================================
   * SSE BUFFER PARSER
   * ==========================================
   */

  function processSSEBuffer(
    buffer
  ) {
    const events = [];

    /*
     * Normalize CRLF
     */

    const normalized =
      buffer.replace(
        /\r\n/g,
        "\n"
      );

    /*
     * Also normalize old CR
     */

    const clean =
      normalized.replace(
        /\r/g,
        "\n"
      );

    /*
     * SSE events are separated
     * by a blank line.
     */

    const chunks =
      clean.split("\n\n");

    /*
     * Last chunk may be incomplete.
     */

    const remaining =
      chunks.pop() || "";

    for (
      const chunk
      of chunks
    ) {
      if (
        !chunk.trim()
      ) {
        continue;
      }

      events.push(
        chunk
      );
    }

    return {
      events,
      remaining,
    };
  }

  /*
   * ==========================================
   * EXTRACT TOKEN
   * ==========================================
   */

  function extractToken(
    event
  ) {
    const lines =
      event.split("\n");

    const dataLines = [];

    /*
     * Extract SSE data lines
     */

    for (
      const line
      of lines
    ) {
      if (
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

    /*
     * No data
     */

    if (
      dataLines.length === 0
    ) {
      return null;
    }

    const data =
      dataLines.join("\n");

    /*
     * Done
     */

    if (
      data === "[DONE]"
    ) {
      return "[DONE]";
    }

    /*
     * ======================================
     * JSON RESPONSE
     * ======================================
     */

    try {
      const parsed =
        JSON.parse(data);

      /*
       * JSON string
       */

      if (
        typeof parsed ===
        "string"
      ) {
        return parsed;
      }

      /*
       * Workers AI:
       * { response: "..." }
       */

      if (
        typeof parsed.response ===
        "string"
      ) {
        return parsed.response;
      }

      /*
       * Generic:
       * { text: "..." }
       */

      if (
        typeof parsed.text ===
        "string"
      ) {
        return parsed.text;
      }

      /*
       * Generic:
       * { content: "..." }
       */

      if (
        typeof parsed.content ===
        "string"
      ) {
        return parsed.content;
      }

      /*
       * Generic:
       * { token: "..." }
       */

      if (
        typeof parsed.token ===
        "string"
      ) {
        return parsed.token;
      }

      /*
       * Nested:
       * { response: { text: "..." } }
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
       * OpenAI-compatible:
       * choices[].delta.content
       */

      if (
        Array.isArray(
          parsed.choices
        ) &&
        parsed.choices.length > 0
      ) {
        const choice =
          parsed.choices[0];

        if (
          choice.delta &&
          typeof choice.delta.content ===
            "string"
        ) {
          return (
            choice.delta.content
          );
        }

        if (
          choice.message &&
          typeof choice.message.content ===
            "string"
        ) {
          return (
            choice.message.content
          );
        }

        if (
          typeof choice.text ===
            "string"
        ) {
          return choice.text;
        }
      }

      /*
       * Unknown JSON structure.
       */

      return null;

    } catch {
      /*
       * Plain text SSE:
       *
       * data: hello
       */

      return data;
    }
  }

  /*
   * ==========================================
   * MESSAGE UI
   * ==========================================
   */

  function addMessage(
    role,
    text
  ) {
    const element =
      createMessageElement(
        role
      );

    element.content.textContent =
      text;

    messages.appendChild(
      element.container
    );

    scrollToBottom();
  }

  function createMessageElement(
    role
  ) {
    const container =
      document.createElement(
        "div"
      );

    container.className =
      `message ${role}`;

    const avatar =
      document.createElement(
        "div"
      );

    avatar.className =
      "message-avatar";

    avatar.textContent =
      role === "assistant"
        ? "F"
        : "You";

    const content =
      document.createElement(
        "div"
      );

    content.className =
      "message-content";

    if (
      role === "assistant"
    ) {
      container.appendChild(
        avatar
      );

      container.appendChild(
        content
      );
    } else {
      container.appendChild(
        content
      );

      container.appendChild(
        avatar
      );
    }

    return {
      container,
      content,
    };
  }

  /*
   * ==========================================
   * CHAT HISTORY
   * ==========================================
   */

  function saveHistory() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          conversation
        )
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

      if (!saved) {
        return;
      }

      const parsed =
        JSON.parse(saved);

      if (
        !Array.isArray(parsed)
      ) {
        return;
      }

      conversation =
        parsed.filter(
          (message) =>
            message &&
            (
              message.role ===
                "user" ||
              message.role ===
                "assistant"
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

    for (
      const message
      of conversation
    ) {
      addMessage(
        message.role,
        message.content
      );
    }
  }

  /*
   * ==========================================
   * NEW CHAT
   * ==========================================
   */

  function newChat() {
    if (isStreaming) {
      return;
    }

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

  /*
   * ==========================================
   * WELCOME
   * ==========================================
   */

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

  /*
   * ==========================================
   * LOADING STATE
   * ==========================================
   */

  function setLoading(
    loading
  ) {
    if (sendButton) {
      sendButton.disabled =
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

    if (messageInput) {
      messageInput.disabled =
        loading;
    }
  }

  /*
   * ==========================================
   * TEXTAREA AUTO RESIZE
   * ==========================================
   */

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
  }

  /*
   * ==========================================
   * SCROLL
   * ==========================================
   */

  function scrollToBottom() {
    if (!chatArea) {
      return;
    }

    requestAnimationFrame(
      () => {
        chatArea.scrollTop =
          chatArea.scrollHeight;
      }
    );
  }

  /*
   * ==========================================
   * START
   * ==========================================
   */

  init();

})();

এখানে আলাদা করে শেষে আর কোনো "fetch()" লিখবে না। "sendMessage()"-এর এই অংশটাই একমাত্র API call:

const response = await fetch("/api/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Accept": "text/event-stream"
  },
  body: JSON.stringify({
    messages: conversation
  })
});

