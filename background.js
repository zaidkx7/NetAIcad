// Background service worker for handling AI API requests

const SYSTEM_PROMPT = `SYSTEM:
You are an AI assistant that answers multiple-choice programming or math questions.
You must always return only the correct option letter (A, B, C, or D) — nothing else.

Rules:
1. Think carefully before answering; simulate the code or calculate the math internally.
2. Do not explain or include reasoning.
3. Output only one character: A, B, C, or D.
4. Never include punctuation, words, or extra spaces — only the letter.

End.
`
const temperature = 0;
const top_p = 1.0;
const max_tokens = 500;
const presence_penalty = 0;
const frequency_penalty = 0;

// OpenRouter Model Mapping
const OPENROUTER_MODELS = {
  "DeepSeek": "deepseek/deepseek-v3.2-exp",
  "GPT-5 Pro": "openai/gpt-5-pro",
  "Claude Sonnet 4.5": "anthropic/claude-sonnet-4.5",
  "Qwen3 Coder Plus": "qwen/qwen3-coder-plus",
  "GLM": "z-ai/glm-4.6",
  "Grok 4 Fast": "x-ai/grok-4-fast",
  "GPT-5 Codex": "openai/gpt-5-codex",
  "Qwen3 Coder Flash": "qwen/qwen3-coder-flash"
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getAnswer') {
    handleGetAnswer(request.question, request.options, request.modelType)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
});

async function handleGetAnswer(question, options, modelType = 'simple') {
  try {
    // Get settings from storage
    const settings = await chrome.storage.sync.get([
      'simpleModel', 
      'codingModel', 
      'openRouterApiKey',
      'aiProvider',
      'apiKey'
    ]);

    // Determine which model to use based on modelType
    let provider, modelId, apiKey;

    if (modelType === 'simple') {
      modelId = settings.simpleModel;
    } else if (modelType === 'coding') {
      modelId = settings.codingModel;
    }

    // Check if it's an OpenRouter model
    if (modelId && OPENROUTER_MODELS[modelId]) {
      provider = 'openrouter';
      apiKey = settings.openRouterApiKey;
      if (!apiKey) {
        throw new Error('OpenRouter API key not configured. Please set it in the extension popup.');
      }
    } else if (modelId === 'groq' || modelId === 'gemini') {
      // Legacy provider support
      provider = modelId;
      apiKey = settings.apiKey;
      if (!apiKey) {
        throw new Error('API key not configured. Please set it in the extension popup.');
      }
    } else {
      // Fallback to old provider system if no model selected
      provider = settings.aiProvider || 'groq';
      apiKey = settings.apiKey;
      if (!apiKey) {
        throw new Error('API key not configured. Please set it in the extension popup.');
      }
    }

    let answerIndex;
    if (provider === 'gemini') {
      answerIndex = await getAnswerFromGemini(question, options, apiKey);
    } else if (provider === 'groq') {
      answerIndex = await getAnswerFromGroq(question, options, apiKey);
    } else if (provider === 'openrouter') {
      answerIndex = await getAnswerFromOpenRouter(question, options, modelId, apiKey);
    } else {
      throw new Error('Unknown AI provider: ' + provider);
    }

    return { success: true, answerIndex: answerIndex };
  } catch (error) {
    console.error('Error getting answer:', error);
    return { success: false, error: error.message };
  }
}

async function getAnswerFromGemini(question, options, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  // Format options with letters
  const formattedOptions = options.map((opt, idx) =>
    `${String.fromCharCode(65 + idx)}. ${opt}`
  ).join('\n');

  const prompt = `Answer this question with ONLY the letter (A, B, C, or D). No explanation.

Question: ${question}

Options:
${formattedOptions}

Answer with only the letter:`;

  const requestBody = {
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      temperature: temperature,
      top_p: top_p,
      max_tokens: max_tokens,
      presence_penalty: presence_penalty,
      frequency_penalty: frequency_penalty,
    },
    safetySettings: [
      {
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_HATE_SPEECH",
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold: "BLOCK_NONE"
      }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();
  console.log('Gemini raw response:', data);
  console.log('Response status:', response.status, response.statusText);

  if (!response.ok) {
    console.error('Gemini API error response:', data);
    throw new Error(`Gemini API error: ${data.error?.message || response.statusText}`);
  }

  console.log('Gemini API response (formatted):', JSON.stringify(data, null, 2));

  // Check if response has the expected structure
  if (!data || typeof data !== 'object' || !data.candidates || data.candidates.length === 0) {
    console.error('Unexpected Gemini response structure:', data);
    console.error('data.candidates:', data.candidates);
    throw new Error('Gemini returned no candidates or an invalid response structure. Full response: ' + JSON.stringify(data));
  }

  // Log the candidate structure for debugging
  console.log('First candidate structure:', JSON.stringify(data.candidates[0], null, 2));

  // Check if content was blocked by safety filters (but MAX_TOKENS is OK if we have content)
  const candidate = data.candidates[0];
  const blockingReasons = ['SAFETY', 'RECITATION', 'OTHER'];

  if (candidate.finishReason && blockingReasons.includes(candidate.finishReason)) {
    console.error('Gemini blocked or filtered the response. Finish reason:', candidate.finishReason);
    console.error('Safety ratings:', candidate.safetyRatings);
    throw new Error(`Gemini blocked the response. Reason: ${candidate.finishReason}. This might be due to content filters.`);
  }

  // Log finish reason for debugging
  if (candidate.finishReason) {
    console.log('Gemini finish reason:', candidate.finishReason);
  }

  const answerText = data.candidates[0]?.content?.parts?.[0]?.text?.trim().toUpperCase();

  if (!answerText) {
    console.error('Could not extract answer text from candidate:', data.candidates[0]);
    console.error('Content:', data.candidates[0]?.content);
    console.error('Parts:', data.candidates[0]?.content?.parts);

    // More detailed error message
    let errorDetails = 'No answer received from Gemini. ';
    if (!data.candidates[0]?.content) {
      errorDetails += 'Response has no content. ';
    } else if (!data.candidates[0]?.content?.parts) {
      errorDetails += 'Content has no parts. ';
    } else if (!data.candidates[0]?.content?.parts?.[0]) {
      errorDetails += 'Parts array is empty. ';
    } else if (!data.candidates[0]?.content?.parts?.[0]?.text) {
      errorDetails += 'First part has no text. ';
    }
    errorDetails += 'Full response: ' + JSON.stringify(data.candidates[0]);

    throw new Error(errorDetails);
  }

  console.log('Gemini answer text:', answerText);

  // Extract letter from response (handles "A", "A.", "Answer: A", etc.)
  const letterMatch = answerText.match(/[ABCD]/);
  if (!letterMatch) {
    throw new Error('Invalid answer format from Gemini: ' + answerText);
  }

  const answerLetter = letterMatch[0];
  const answerIndex = answerLetter.charCodeAt(0) - 65; // Convert A->0, B->1, etc.

  console.log('Gemini answer:', answerLetter, 'Index:', answerIndex);
  return answerIndex;
}

async function getAnswerFromOpenRouter(question, options, modelName, apiKey) {
  const url = 'https://openrouter.ai/api/v1/chat/completions';

  // Format options with letters
  const formattedOptions = options.map((opt, idx) =>
    `${String.fromCharCode(65 + idx)}. ${opt}`
  ).join('\n');

  const prompt = `Answer this question with ONLY the letter (A, B, C, or D). No explanation.

Question: ${question}

Options:
${formattedOptions}

Answer with only the letter:`;

  const requestBody = {
    model: OPENROUTER_MODELS[modelName],
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: temperature,
    top_p: top_p,
    max_tokens: max_tokens,
    presence_penalty: presence_penalty,
    frequency_penalty: frequency_penalty,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();

  console.log('OpenRouter full response:', JSON.stringify(data, null, 2));
  console.log('Response status:', response.status, response.statusText);

  if (!response.ok) {
    console.error('OpenRouter API error response:', data);
    throw new Error(`OpenRouter API error: ${data.error?.message || response.statusText}`);
  }

  // Check response structure
  console.log('data.choices:', data.choices);
  console.log('data.choices[0]:', data.choices?.[0]);
  console.log('data.choices[0].message:', data.choices?.[0]?.message);
  console.log('data.choices[0].message.content:', data.choices?.[0]?.message?.content);

  const rawContent = data.choices?.[0]?.message?.content;
  const answerText = rawContent?.trim().toUpperCase();

  if (!answerText) {
    console.error('Empty or undefined answer text from OpenRouter');
    console.error('Raw content:', rawContent);
    console.error('Finish reason:', data.choices?.[0]?.finish_reason);
    console.error('Full response data:', JSON.stringify(data, null, 2));

    // More detailed error message
    let errorDetails = 'No answer received from OpenRouter. ';
    if (!data.choices) {
      errorDetails += 'Response has no choices array. ';
    } else if (data.choices.length === 0) {
      errorDetails += 'Choices array is empty. ';
    } else if (!data.choices[0].message) {
      errorDetails += 'First choice has no message. ';
    } else if (!data.choices[0].message.content) {
      errorDetails += 'Message has no content. ';
    } else if (data.choices[0].message.content.trim() === '') {
      errorDetails += 'Message content is empty/whitespace. ';
    }

    // Check if token limit was hit
    if (data.choices[0]?.finish_reason === 'length') {
      errorDetails += 'Response was cut off due to token limit (increase max_tokens). ';
    }

    errorDetails += 'Full response: ' + JSON.stringify(data);

    throw new Error(errorDetails);
  }

  console.log('OpenRouter raw answer:', answerText);

  // Extract letter from response
  const letterMatch = answerText.match(/[ABCD]/);
  if (!letterMatch) {
    throw new Error('Invalid answer format from OpenRouter: ' + answerText);
  }

  const answerLetter = letterMatch[0];
  const answerIndex = answerLetter.charCodeAt(0) - 65; // Convert A->0, B->1, etc.

  console.log('OpenRouter answer:', answerLetter, 'Index:', answerIndex, 'Model:', modelName);
  return answerIndex;
}

async function getAnswerFromGroq(question, options, apiKey) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';

  // Format options with letters
  const formattedOptions = options.map((opt, idx) =>
    `${String.fromCharCode(65 + idx)}. ${opt}`
  ).join('\n');

  const prompt = `Answer this question with ONLY the letter (A, B, C, or D). No explanation.

Question: ${question}

Options:
${formattedOptions}

Answer with only the letter:`;

  const requestBody = {
    model: 'llama-3.3-70b-versatile', // Fast and accurate model
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: temperature,
    top_p: top_p,
    max_tokens: max_tokens,
    presence_penalty: presence_penalty,
    frequency_penalty: frequency_penalty,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Groq API error: ${data.error?.message || response.statusText}`);
  }

  const answerText = data.choices[0]?.message?.content?.trim().toUpperCase();

  if (!answerText) {
    throw new Error('No answer received from Groq');
  }

  // Extract letter from response
  const letterMatch = answerText.match(/[ABCD]/);
  if (!letterMatch) {
    throw new Error('Invalid answer format from Groq: ' + answerText);
  }

  const answerLetter = letterMatch[0];
  const answerIndex = answerLetter.charCodeAt(0) - 65;

  console.log('Groq answer:', answerLetter, 'Index:', answerIndex);
  return answerIndex;
}

