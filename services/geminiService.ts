export interface ChatHistoryItem {
  role: 'user' | 'model';
  text: string;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const serverMessage =
      typeof data?.error === 'string' && data.error.trim().length > 0
        ? data.error
        : `HTTP ${response.status}`;
    throw new Error(serverMessage);
  }

  return data as T;
}

export const chatWithLegalAI = async (
  message: string,
  history: ChatHistoryItem[]
): Promise<string> => {
  const data = await postJson<{ text?: string }>('/api/chat', {
    message,
    history,
  });

  if (!data?.text || !data.text.trim()) {
    throw new Error('لم يتم استلام رد صالح من الخادم.');
  }

  return data.text.trim();
};

export const voiceConsultWithLegalAI = async (
  spokenInquiry: string,
  callHistory: ChatHistoryItem[]
): Promise<string> => {
  const data = await postJson<{ text?: string }>('/api/voice-consult', {
    spokenInquiry,
    callHistory,
  });

  if (!data?.text || !data.text.trim()) {
    throw new Error('لم يتم استلام رد صوتي صالح من الخادم.');
  }

  return data.text.trim();
};
