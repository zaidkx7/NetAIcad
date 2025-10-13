// Popup script for configuration
document.addEventListener('DOMContentLoaded', async () => {
  const simpleModelSelect = document.getElementById('simpleModel');
  const codingModelSelect = document.getElementById('codingModel');
  const openRouterApiKeyInput = document.getElementById('openRouterApiKey');
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusDiv = document.getElementById('status');

  // Load saved settings
  const settings = await chrome.storage.sync.get([
    'simpleModel',
    'codingModel',
    'openRouterApiKey',
    'apiKey',
    'aiProvider' // For backward compatibility
  ]);

  if (settings.simpleModel) {
    simpleModelSelect.value = settings.simpleModel;
  } else if (settings.aiProvider) {
    // Migrate old settings
    simpleModelSelect.value = settings.aiProvider;
  }

  if (settings.codingModel) {
    codingModelSelect.value = settings.codingModel;
  }

  if (settings.openRouterApiKey) {
    openRouterApiKeyInput.value = settings.openRouterApiKey;
  }

  if (settings.apiKey) {
    apiKeyInput.value = settings.apiKey;
  }

  // Save settings
  saveBtn.addEventListener('click', async () => {
    const simpleModel = simpleModelSelect.value;
    const codingModel = codingModelSelect.value;
    const openRouterApiKey = openRouterApiKeyInput.value.trim();
    const apiKey = apiKeyInput.value.trim();

    // Validation
    if (!simpleModel && !codingModel) {
      showStatus('Please select at least one model', 'error');
      return;
    }

    // Check if OpenRouter models are selected but no OpenRouter API key
    const openRouterModels = [
      'DeepSeek', 'GPT-5 Pro', 'Claude Sonnet 4.5', 'Qwen3 Coder Plus',
      'GLM', 'Grok 4 Fast', 'GPT-5 Codex', 'Qwen3 Coder Flash'
    ];

    const needsOpenRouterKey = openRouterModels.includes(simpleModel) || 
                                openRouterModels.includes(codingModel);

    if (needsOpenRouterKey && !openRouterApiKey) {
      showStatus('OpenRouter API key required for selected models', 'error');
      return;
    }

    // Check if legacy providers are selected but no legacy API key
    const needsLegacyKey = simpleModel === 'groq' || simpleModel === 'gemini' ||
                           codingModel === 'groq' || codingModel === 'gemini';

    if (needsLegacyKey && !apiKey) {
      showStatus('API key required for Groq/Gemini', 'error');
      return;
    }

    try {
      await chrome.storage.sync.set({
        simpleModel: simpleModel,
        codingModel: codingModel,
        openRouterApiKey: openRouterApiKey,
        apiKey: apiKey,
        aiProvider: simpleModel // For backward compatibility
      });

      showStatus('Settings saved successfully!', 'success');
    } catch (error) {
      showStatus('Error saving settings: ' + error.message, 'error');
    }
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;
    statusDiv.style.display = 'block';

    if (type === 'success') {
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 3000);
    }
  }
});
