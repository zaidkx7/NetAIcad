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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getAnswer') {
    handleGetAnswer(request.question, request.options, request.modelType)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
});

async function handleGetAnswer(question, options, modelType) {
  try {
    // Get settings from storage
    const settings = await chrome.storage.sync.get([
      'geminiApiKey',
      'openAiApiKey'
    ]);

    let answerIndex;

    if (modelType === 'gpt') {
      const apiKey = settings.openAiApiKey;
      if (!apiKey) {
        throw new Error('OpenAI API key not configured. Please set it in the extension popup.');
      }
      answerIndex = await getAnswerFromOpenAI(question, options, apiKey);
    } else if (modelType === 'gemini') {
      const apiKey = settings.geminiApiKey;
      if (!apiKey) {
        throw new Error('Gemini API key not configured. Please set it in the extension popup.');
      }
      answerIndex = await getAnswerFromGemini(question, options, apiKey);
    } else {
      throw new Error('Unknown model type: ' + modelType);
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

async function getAnswerFromOpenAI(question, options, apiKey) {
  const url = 'https://api.openai.com/v1/chat/completions';

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
    model: 'gpt-4o-mini',
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

  console.log('OpenAI full response:', JSON.stringify(data, null, 2));
  console.log('Response status:', response.status, response.statusText);

  if (!response.ok) {
    console.error('OpenAI API error response:', data);
    throw new Error(`OpenAI API error: ${data.error?.message || response.statusText}`);
  }

  const rawContent = data.choices?.[0]?.message?.content;
  const answerText = rawContent?.trim().toUpperCase();

  if (!answerText) {
    console.error('Empty or undefined answer text from OpenAI');
    console.error('Raw content:', rawContent);
    console.error('Finish reason:', data.choices?.[0]?.finish_reason);
    console.error('Full response data:', JSON.stringify(data, null, 2));

    let errorDetails = 'No answer received from OpenAI. ';
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

    if (data.choices[0]?.finish_reason === 'length') {
      errorDetails += 'Response was cut off due to token limit. ';
    }

    errorDetails += 'Full response: ' + JSON.stringify(data);
    throw new Error(errorDetails);
  }

  console.log('OpenAI raw answer:', answerText);

  // Extract letter from response
  const letterMatch = answerText.match(/[ABCD]/);
  if (!letterMatch) {
    throw new Error('Invalid answer format from OpenAI: ' + answerText);
  }

  const answerLetter = letterMatch[0];
  const answerIndex = answerLetter.charCodeAt(0) - 65;

  console.log('OpenAI answer:', answerLetter, 'Index:', answerIndex, 'Model: gpt-4o-mini');
  return answerIndex;
}

