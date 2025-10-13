const API_KEY = "YOUR_API_KEY_HERE"; // <-- Replace this
const MODELS = {
  "DeepSeek": "deepseek/deepseek-v3.2-exp",
  "GPT-5 Pro": "openai/gpt-5-pro",
  "Claude Sonnet 4.5": "anthropic/claude-sonnet-4.5",
  "Qwen3 Coder Plus": "qwen/qwen3-coder-plus",
  "GLM": "z-ai/glm-4.6",
  "Grok 4 Fast": "x-ai/grok-4-fast",
  "GPT-5 Codex": "openai/gpt-5-codex",
  "Qwen3 Coder Flash": "qwen/qwen3-coder-flash",
};
const QUESTION = `
What will be the output of the following JavaScript code?

const obj = {
  value: 10,
  getValue: () => {
    return this.value + 5;
  }
};

console.log(obj.getValue());
`;
const OPTIONS = "A. 15, B. undefined, C. NaN, D. Throws an error";
const PROMPT = `Question: ${QUESTION}\nOptions: ${OPTIONS}\nAnswer with only the correct option letter.`;
const SYSTEM_PROMPT = "You are a helpful AI that answers correctly.";

async function testOpenRouterOfficial(MODEL_NAME) {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODELS[MODEL_NAME],
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: PROMPT }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status} - ${errText}`);
    }

    const data = await response.json();
    console.log("✅ Response:", MODEL_NAME);
    console.log("🧠 Answer:", data.choices[0].message.content.trim());
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

console.log("Correct Option: C. NaN");

testOpenRouterOfficial("DeepSeek");
testOpenRouterOfficial("GPT-5 Pro");
testOpenRouterOfficial("Claude Sonnet 4.5");
testOpenRouterOfficial("Qwen3 Coder Plus");
testOpenRouterOfficial("GLM");
testOpenRouterOfficial("Grok 4 Fast");
testOpenRouterOfficial("GPT-5 Codex");
testOpenRouterOfficial("Qwen3 Coder Flash");