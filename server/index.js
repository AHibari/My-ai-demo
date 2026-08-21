require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const API_KEY = process.env.OPENAI_API_KEY || '';
const AVAILABLE_MODELS = [...new Set([
  ...(process.env.AVAILABLE_MODELS ? process.env.AVAILABLE_MODELS.split(',') : []),
  AI_MODEL,
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4.1-mini',
  'deepseek-chat'
])].filter(Boolean);

app.use(express.json());
// Serve the demo client
app.use(express.static(path.join(__dirname, '..', 'client', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'AI demo', model: AI_MODEL, configured: Boolean(API_KEY) });
});

app.get('/api/models', (req, res) => {
  res.json({ models: AVAILABLE_MODELS });
});

app.post('/api/normalize', async (req, res) => {
  const { text, model } = req.body || {};
  const t = (text || '').trim();
  if (!t) return res.status(400).json({ error: 'text required' });
  const requestedModel = getModelName(model);
  try {
    const prompt = `请把下面的口语化文本转换为书面、修正错别字，并提取用户的意图。严格只输出一个 JSON 对象，字段：normalized（转换后文本），intent（简要意图），confidence（置信度 0-1）。不要输出额外说明。\n\n文本：\n${t}`;
    const resp = await fetch(`${AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: requestedModel,
        messages: [
          { role: 'system', content: '你是一个文本处理助手，输出必须是 JSON 格式，且仅有 JSON 对象。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.0,
        max_tokens: 300
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(502).json({ error: 'AI error', detail: text });
    }

    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content || '';
    let parsed = null;
    try { parsed = JSON.parse(reply); } catch (e) {
      const m = reply.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch (e2) { parsed = null; }
      }
    }
    if (!parsed) parsed = { normalized: reply, intent: '', confidence: 0 };
    return res.json(parsed);
  } catch (err) {
    console.error('Normalize failed', err);
    res.status(500).json({ error: 'normalize failed', detail: err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const { message, stream, fileName, fileContent, model, history = [], summary } = req.body || {};
  const trimmedMessage = (message || '').trim();
  if (!trimmedMessage) return res.status(400).json({ error: '消息不能为空' });

  const requestedModel = getModelName(model);
  const promptWithFile = buildPromptWithFile(trimmedMessage, fileName, fileContent);
  const messages = buildConversationMessages(history, promptWithFile, summary);

  if (!API_KEY) {
    return res.json({ reply: '未配置 OPENAI_API_KEY，请参考 server/.env.example 配置后重试。' });
  }

  if (stream) {
    return streamChat(req, res, messages, requestedModel);
  }

  try {
    const resp = await fetch(`${AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: requestedModel,
        messages,
        temperature: 0.7
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('AI API error:', text);
      return res.status(502).json({ error: 'AI 服务调用失败', detail: text });
    }

    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content || 'AI 未返回有效内容';
    console.log('Tokens used:', data?.usage);
    res.json({ reply });
  } catch (err) {
    console.error('Chat failed:', err);
    res.status(500).json({ error: '服务异常', detail: err.message });
  }
});

function getModelName(model) {
  const candidate = String(model || '').trim();
  if (!candidate) return AI_MODEL;
  return AVAILABLE_MODELS.includes(candidate) ? candidate : AI_MODEL;
}

function buildConversationMessages(history, latestMessage, summary) {
  const safeHistory = Array.isArray(history) ? history : [];
  const trimmedHistory = safeHistory.slice(-12).map((entry) => {
    const type = entry?.role === 'assistant' ? 'assistant' : 'user';
    const text = typeof entry?.content === 'string' ? entry.content : '';
    return { role: type, content: text.trim() || '...' };
  }).filter((entry) => entry.content);

  const systemParts = [
    '你是一个专业、简洁、乐于助人的 AI 助手。请保持上下文连续，并结合之前的对话进行回答。'
  ];

  if (summary && String(summary).trim()) {
    systemParts.push(`这是当前会话的历史摘要：${String(summary).trim()}`);
  }

  const systemPrompt = {
    role: 'system',
    content: systemParts.join('\n\n')
  };

  return [systemPrompt, ...trimmedHistory, { role: 'user', content: latestMessage }];
}

function buildPromptWithFile(message, fileName, fileContent) {
  if (!fileName || !fileContent) return message;

  const sanitizedFileContent = String(fileContent).slice(0, 12000);
  return `我上传了一个文件：${fileName}\n\n文件内容如下：\n${sanitizedFileContent}\n\n请基于上述文件内容回答我的问题。\n\n用户问题：${message}`;
}

async function streamChat(req, res, messages, model) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const writeEvent = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const resp = await fetch(`${AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: model || AI_MODEL,
        messages,
        temperature: 0.7,
        stream: true
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('AI stream error:', text);
      writeEvent({ type: 'error', text: 'AI 服务调用失败' });
      res.end();
      return;
    }

    if (!resp.body) {
      throw new Error('AI 服务未返回可读流');
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n\r?\n/);
      buffer = lines.pop() || '';

      for (const block of lines) {
        const trimmed = block.trim();
        if (!trimmed) continue;

        const payloadLines = trimmed.split(/\r?\n/);
        for (const payloadLine of payloadLines) {
          if (!payloadLine.startsWith('data:')) continue;
          const dataStr = payloadLine.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;

          try {
            const data = JSON.parse(dataStr);
            const delta = data?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta) {
              writeEvent({ type: 'content', text: delta });
            }
          } catch (parseErr) {
            console.warn('Invalid stream data:', dataStr, parseErr);
          }
        }
      }
    }

    if (buffer.trim()) {
      const payloadLines = buffer.split(/\r?\n/);
      for (const payloadLine of payloadLines) {
        if (!payloadLine.startsWith('data:')) continue;
        const dataStr = payloadLine.slice(5).trim();
        if (!dataStr || dataStr === '[DONE]') continue;
        try {
          const data = JSON.parse(dataStr);
          const delta = data?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            writeEvent({ type: 'content', text: delta });
          }
        } catch (parseErr) {
          console.warn('Invalid final stream data:', dataStr, parseErr);
        }
      }
    }

    writeEvent({ type: 'done' });
    res.end();
  } catch (err) {
    console.error('Chat stream failed:', err);
    writeEvent({ type: 'error', text: err.message || '流式输出失败' });
    res.end();
  }
}

// Fallback: serve index.html for SPA routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AI demo server running: http://localhost:${PORT}`);
  console.log(`Model: ${AI_MODEL}, AI_BASE_URL: ${AI_BASE_URL}`);
});
