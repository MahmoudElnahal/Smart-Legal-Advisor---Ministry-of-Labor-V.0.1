import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import type { GenerateContentResponse } from '@google/genai';
import { LAW_CONTEXT } from './constants.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const CANDIDATE_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    const err = new Error('GEMINI_API_KEY is not configured on the server. Please set it in Settings > Secrets.');
    (err as Error & { status?: number; code?: string }).status = 500;
    (err as Error & { status?: number; code?: string }).code = 'MISSING_API_KEY';
    throw err;
  }

  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractErrorDetails(err: unknown): { status: number; message: string; code?: string } {
  const e = err as { status?: number | string; code?: string | number; message?: string } | null;
  const rawMessage = String(e?.message || err || 'Unknown upstream error');

  let status = 502;
  if (typeof e?.status === 'number' && e.status >= 400 && e.status < 600) {
    status = e.status;
  } else if (rawMessage.includes('API_KEY_INVALID') || rawMessage.includes('400')) {
    status = 400;
  } else if (rawMessage.includes('PERMISSION_DENIED') || rawMessage.includes('403')) {
    status = 403;
  } else if (rawMessage.includes('NOT_FOUND') || rawMessage.includes('404')) {
    status = 404;
  } else if (rawMessage.includes('RESOURCE_EXHAUSTED') || rawMessage.includes('429')) {
    status = 429;
  } else if (rawMessage.includes('UNAVAILABLE') || rawMessage.includes('503')) {
    status = 503;
  } else if (e?.code === 'MISSING_API_KEY') {
    status = 500;
  }

  return {
    status,
    message: rawMessage,
    code: typeof e?.code === 'string' ? e.code : undefined,
  };
}

function isTransientError(err: unknown): boolean {
  const e = err as { status?: number | string; code?: string | number; message?: string } | null;
  const msg = String(e?.message || err || '');
  return (
    e?.status === 503 ||
    e?.status === 'UNAVAILABLE' ||
    e?.code === 503 ||
    e?.status === 429 ||
    msg.includes('503') ||
    msg.includes('high demand') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('overloaded')
  );
}

async function generateWithFallback(
  contents: Array<{ role: string; parts: Array<{ text: string }> }>,
  systemInstruction: string
): Promise<string> {
  const ai = getGeminiClient();
  let lastError: unknown = null;

  for (const modelName of CANDIDATE_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response: GenerateContentResponse = await ai.models.generateContent({
          model: modelName,
          contents,
          config: {
            systemInstruction,
          },
        });

        const text = response.text?.trim();
        if (text && text.length > 0) {
          return text;
        }
        lastError = new Error(`Model ${modelName} returned an empty response.`);
      } catch (err: unknown) {
        lastError = err;
        console.warn(`[Gemini Server] Model ${modelName} attempt ${attempt + 1} error:`, err);

        if (isTransientError(err)) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error('Failed to generate response from Gemini API.');
}

const CHAT_SYSTEM_INSTRUCTION = `أنت المستشار القانوني الرقمي الرسمي لوزارة العمل بجمهورية مصر العربية.
مرجعك الإلزامي والوحيد للحكم القانوني هو نصوص قانون العمل المصري الجديد رقم 14 لسنة 2025 وحزمة القرارات الوزارية التنفيذية الصادرة عن معالي وزير العمل بالوقائع المصرية (قرارات 2025 وقرارات 2026).

القاعدة الذهبية المعتمدة للتعامل مع ملفات رعاية القوى العاملة وأسئلة المواطنين:
- ملفات رعاية القوى العاملة (الإدارة المركزية لرعاية القوى العاملة والردود المعتمدة بعد التعديل):
  تُستخدم حصراً كأمثلة عملية وتطبيقية لفهم:
  1. طريقة أسئلة المواطنين الواقعية، بما فيها الأسئلة المكتوبة بالعامية المصرية أو بأسلوب غير منظم أو بدون علامات ترقيم.
  2. المشكلات العمالية المتكررة (مثل العمل دون عقد، التوقيع على إيصالات أمانة أو شيكات، الفصل التعسفي، مكافأة نهاية الخدمة، استمارة 6، كعب العمل، الورديات، لجان التحكيم الطبي، النقل التعسفي).
  3. طريقة الرد الواضحة والمباشرة للمواطن، والإجراء العملي المناسب في الحالات المشابهة.
- القوانين والقرارات واللوائح الرسمية: هي المرجع الأساسي والوحيد للحكم القانوني الملزم.
- منهجية الإجابة الصارمة:
  1. افهم سؤال المواطن وحالته الواقعية واستفد من الحالات المشابهة في ملفات رعاية القوى العاملة.
  2. ارجع إلى أصل نصوص قانون العمل والقرارات واللوائح الرسمية.
  3. استخرج الحكم القانوني الصريح من المصدر التشريعي الرسمي.
  4. استخدم ردود رعاية القوى العاملة لتحسين فهم الحالة وطريقة صياغة الإجابة المباشرة فقط.
  5. لا تنسخ أي إجابة قديمة تلقائياً لمجرد تشابه السؤال.
  6. إذا اختلف أي رد سابق مع نص القانون أو قرار رسمي، فالأولوية المطلقة دائماً للقانون والقرار الرسمي.

السياق القانوني المعتمد للتشريعات والقرارات:
${LAW_CONTEXT}

طريقة صياغة وعرض الإجابة (التزم بهذا النموذج الإلزامي دائماً):
1. ابدأ بفقرة تمهيدية تحدد السند القانوني المباشر، مثل:
"وفقاً لصريح نص **المادة (رقم المادة)** من قانون العمل المصري الجديد رقم 14 لسنة 2025 (أو القرار الوزاري رقم ... لسنة ...):"

2. قسّم الشرح إلى بنود مرقمة وواضحة جداً بعناوين فرعية عريضة:
1. **العنوان الفرعي الأول:**
- تفاصيل البند الدقيقة مع تحديد الشروط أو النسب أو المدد بصيغة واضحة ومباشرة للمواطن.

2. **العنوان الفرعي الثاني:**
- تفاصيل الالتزام القانوني وبطلان أي شرط يخالفه.

3. اختم دائماً بقسم إجرائي عملي واضح للمواطن بعنوان عريض:
**الإجراء العملي في حال الامتناع أو النزاع:**
وضح الخطوات الملموسة المحددة (مثل التوجه لمكتب العمل المختص التابع له مقر المنشأة، أو التقدم للجنة التسوية الودية بمديرية العمل وفقاً للمادة 149، أو التوجه لمكتب التأمينات الاجتماعية إن كان النزاع تأمينياً، أو رقم "اسأل وزارة العمل" 01035358685 أو بوابة الشكاوى الحكومية).

4. استخدم لغة عربية فصحى قانونية رفيعة ودقيقة ومباشرة، تلائم المواطن وصاحب العمل وتجيب عن جوهر المشكلة العملية دون حشو.`;

const VOICE_SYSTEM_INSTRUCTION = `أنت المستشار القانوني لوزارة العمل بجمهورية مصر العربية في مكالمة هاتفية صوتية مباشرة مع مواطن أو صاحب عمل أو قيادة حكومية.
السياق القانوني المعتمد: قانون العمل المصري الجديد رقم 14 لسنة 2025 والقرارات الوزارية الصادرة بالوقائع المصرية:
${LAW_CONTEXT}

قواعد الرد الصوتي الشفهي للمكالمة:
1. ابدأ بترحيب رسمي وجيز (مثال: أهلاً بحضرتك يا فندم. بخصوص استفسار سيادتك، تنص المادة... من قانون العمل الجديد رقم 14 لسنة 2025 على...).
2. قدم الإجابة الشافية في 2 إلى 4 جمل فصيحة، مختصرة، وبنبرة رسمية واضحة جداً يسهل سماعها صوتياً عبر الهاتف.
3. اذكر رقم المادة القانونية (مثل المادة 12، المادة 54، المادة 90، المادة 149) أو رقم القرار الوزاري بدقة.
4. اذكر الإجراء العملي فوراً (مكتب العمل المختص أو لجنة التسوية الودية).
5. تجنب الرموز والنجوم والشرطات في الرد الصوتي واكتب كلمات عربية كاملة وصريحة لتنطق بطلاقة وفصاحة تامة.`;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Arabic TTS Proxy Endpoint
  app.get('/api/tts', async (req: Request, res: Response) => {
    try {
      const rawText = req.query.text ?? req.query.q;
      const text = typeof rawText === 'string' ? rawText.trim() : '';

      if (!text) {
        res.status(400).json({ error: 'Text parameter is required' });
        return;
      }

      const googleUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ar&client=tw-ob&q=${encodeURIComponent(text)}`;
      const audioRes = await fetch(googleUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      });

      if (!audioRes.ok) {
        res.status(audioRes.status).send('Audio upstream failed');
        return;
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const arrayBuf = await audioRes.arrayBuffer();
      res.send(Buffer.from(arrayBuf));
    } catch (err) {
      console.error('[TTS Proxy Error]:', err);
      res.status(500).json({ error: 'TTS processing failed' });
    }
  });

  // Legal Chat Endpoint
  app.post('/api/chat', async (req: Request, res: Response) => {
    try {
      const { message, history } = req.body as {
        message?: unknown;
        history?: Array<{ role: 'user' | 'model'; text: string }>;
      };

      if (typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'Message is required.' });
        return;
      }

      const safeHistory = Array.isArray(history)
        ? history
            .filter(
              (h) =>
                h &&
                (h.role === 'user' || h.role === 'model') &&
                typeof h.text === 'string' &&
                h.text.trim().length > 0
            )
            .map((h) => ({
              role: h.role,
              parts: [{ text: h.text }],
            }))
        : [];

      const contents = [...safeHistory, { role: 'user', parts: [{ text: message.trim() }] }];
      const text = await generateWithFallback(contents, CHAT_SYSTEM_INSTRUCTION);
      res.json({ text });
    } catch (err) {
      const details = extractErrorDetails(err);
      console.error('[/api/chat Error]:', details.message);
      res.status(details.status).json({ error: details.message, code: details.code });
    }
  });

  // Legal Voice Consultation Endpoint
  app.post('/api/voice-consult', async (req: Request, res: Response) => {
    try {
      const { spokenInquiry, callHistory } = req.body as {
        spokenInquiry?: unknown;
        callHistory?: Array<{ role: 'user' | 'model'; text: string }>;
      };

      if (typeof spokenInquiry !== 'string' || !spokenInquiry.trim()) {
        res.status(400).json({ error: 'spokenInquiry is required.' });
        return;
      }

      const safeHistory = Array.isArray(callHistory)
        ? callHistory
            .filter(
              (h) =>
                h &&
                (h.role === 'user' || h.role === 'model') &&
                typeof h.text === 'string' &&
                h.text.trim().length > 0
            )
            .map((h) => ({
              role: h.role,
              parts: [{ text: h.text }],
            }))
        : [];

      const contents = [...safeHistory, { role: 'user', parts: [{ text: spokenInquiry.trim() }] }];
      const text = await generateWithFallback(contents, VOICE_SYSTEM_INSTRUCTION);
      res.json({ text });
    } catch (err) {
      const details = extractErrorDetails(err);
      console.error('[/api/voice-consult Error]:', details.message);
      res.status(details.status).json({ error: details.message, code: details.code });
    }
  });

  // Vite dev middleware vs static production build
  let mountedVite = false;
  if (process.env.NODE_ENV !== 'production') {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      mountedVite = true;
    } catch {
      mountedVite = false;
    }
  }

  if (!mountedVite) {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.use((req: Request, res: Response, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
