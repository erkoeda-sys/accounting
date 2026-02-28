'use strict';

const chatContainer = document.getElementById('chatContainer');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const reloadBtn = document.getElementById('reloadBtn');
const pdfList = document.getElementById('pdfList');
const welcomeMessage = document.getElementById('welcomeMessage');

/** Conversation history sent to the API */
const messages = [];

let isStreaming = false;

// ===== Auto-resize textarea =====
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 160) + 'px';
  sendBtn.disabled = userInput.value.trim() === '' || isStreaming;
});

// ===== Send on Enter (Shift+Enter = newline) =====
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) send();
  }
});

sendBtn.addEventListener('click', send);

// ===== Insert example question =====
function insertExample(el) {
  userInput.value = el.textContent.trim();
  userInput.dispatchEvent(new Event('input'));
  userInput.focus();
}
window.insertExample = insertExample;

// ===== Reload PDFs =====
reloadBtn.addEventListener('click', async () => {
  reloadBtn.classList.add('loading');
  reloadBtn.disabled = true;
  document.getElementById('reloadIcon').textContent = '⟳';

  try {
    const res = await fetch('/api/reload', { method: 'POST' });
    const pdfs = await res.json();
    renderPdfList(pdfs);
  } catch {
    alert('再読み込みに失敗しました');
  } finally {
    reloadBtn.classList.remove('loading');
    reloadBtn.disabled = false;
    document.getElementById('reloadIcon').textContent = '↺';
  }
});

function renderPdfList(pdfs) {
  if (pdfs.length === 0) {
    pdfList.innerHTML = `<li class="pdf-item pdf-empty"><span class="pdf-icon">⚠️</span><span class="pdf-name">PDFが見つかりません</span></li>`;
    return;
  }
  pdfList.innerHTML = pdfs.map(p =>
    `<li class="pdf-item"><span class="pdf-icon">📄</span><span class="pdf-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span></li>`
  ).join('');
}

// ===== Send message =====
async function send() {
  const text = userInput.value.trim();
  if (!text || isStreaming) return;

  // Hide welcome message
  if (welcomeMessage) welcomeMessage.style.display = 'none';

  // Append user message
  messages.push({ role: 'user', content: text });
  appendMessage('user', text);

  // Reset input
  userInput.value = '';
  userInput.style.height = 'auto';
  sendBtn.disabled = true;
  isStreaming = true;

  // Show typing indicator
  const typingRow = appendTyping();

  // Stream AI response
  let aiText = '';
  let aiBubble = null;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;

        try {
          const parsed = JSON.parse(data);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.text) {
            aiText += parsed.text;
            if (!aiBubble) {
              typingRow.remove();
              aiBubble = appendMessage('ai', aiText);
            } else {
              aiBubble.textContent = aiText;
              scrollToBottom();
            }
          }
        } catch (parseErr) {
          if (parseErr.message !== 'Unexpected end of JSON input') throw parseErr;
        }
      }
    }

    if (!aiBubble) {
      typingRow.remove();
      aiBubble = appendMessage('ai', aiText || '（応答がありませんでした）');
    }
    messages.push({ role: 'assistant', content: aiText });

  } catch (err) {
    typingRow.remove();
    appendMessage('ai', `エラーが発生しました: ${err.message}`, true);
    // Remove the user message from history if we couldn't get a response
    messages.pop();
  } finally {
    isStreaming = false;
    sendBtn.disabled = userInput.value.trim() === '';
  }
}

// ===== DOM helpers =====
function appendMessage(role, text, isError = false) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const avatar = document.createElement('div');
  avatar.className = `avatar ${role}`;
  avatar.textContent = role === 'user' ? '👤' : '🤖';

  const bubble = document.createElement('div');
  bubble.className = `bubble${isError ? ' error' : ''}`;
  bubble.textContent = text;

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatContainer.appendChild(row);
  scrollToBottom();
  return bubble;
}

function appendTyping() {
  const row = document.createElement('div');
  row.className = 'message-row ai';

  const avatar = document.createElement('div');
  avatar.className = 'avatar ai';
  avatar.textContent = '🤖';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatContainer.appendChild(row);
  scrollToBottom();
  return row;
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
