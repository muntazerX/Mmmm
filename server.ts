import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    })
  : null;

async function startServer() {
  const app = express();
  app.use(express.json());

  const isProduction = process.env.NODE_ENV === 'production';

  // API Route for game narration and AI interaction with Story Summary Context Memory Window
  app.post('/api/narrate', async (req, res) => {
    try {
      const { prompt, gameState } = req.body;
      const p = gameState?.player || {};
      const w = gameState?.world_state || {};
      const storySummary: Array<{ turn: number; day: number; text: string; type?: string }> = Array.isArray(
        gameState?.story_summary
      )
        ? gameState.story_summary
        : [];

      // Format the memory window strictly from the story summary entries (the condensed record)
      const memoryText =
        storySummary.length > 0
          ? storySummary
              .slice(-40)
              .map((s) => `[اليوم ${s.day} · الدور ${s.turn}]: ${s.text}`)
              .join('\n')
          : 'بداية الرحلة في القارة: مسافر مبتدئ يستكشف أرجاء التربة القاتمة.';

      if (!ai) {
        const fallbackNarrative = `استجابت وقائع [${p.current_landmark || 'المنطقة'}] لقرارك: "${prompt}". مضت الساعات بهدوء وثبات في أرجاء التربة القاتمة.`;
        const fallbackSummary = `قام اللاعب بـ: "${prompt}" في [${p.current_landmark || 'المنطقة'}].`;
        return res.json({
          content: fallbackNarrative,
          summary: fallbackSummary,
          updates: { daysPassed: /نوم|مبيت|نزل|أنام|تخييم/i.test(prompt) ? 1 : 0 }
        });
      }

      const systemInstruction = `أنت محرك القصة والراوي الحي والذاكرة التراكمية الدائمة للعبة تقمص أدوار نصية خشنة ومظلمة باللغة العربية بعنوان "التربة القاتمة" (Grim Soil).
عالم اللعبة: فنون مرويم، خيال مظلم، فقر، دماء، سياسة ممالك، صراع طوائف، وميزان تجارة صارم.

قواعد الذاكرة وسياق القصة (حاسمة وصارمة جداً):
1. ذاكرتك وسياقك الأساسي يعتمد بالكامل على سجل "ملخص القصة" المرفق في رسالة المستخدم. يجب عليك قراءته ومراجعته حرفياً والمرور عليه قبل كتابة أي كلمة، حتى لا تنسى أي حدث: شخص قتله اللاعب أو حارب معه، بضاعة اشتراها أو باعها، اتفاقات وتحالفات، أو أفعاله السابقة.
2. ما كتبه اللاعب وما ترده عليه في هذه اللحظة يشكل "جولة واحدة".
3. في حقل "narrative": اكتب السرد الروائي الملحمي والدرامي المشوق لما حدث باللغة العربية الفصحى (بين 2 إلى 4 أسطر)، محتفظاً بالجو المظلم والواقعي.
4. في حقل "summary": لخص هذه الجولة بالتحديد (ما كتبه اللاعب والنتيجة الصافية لما حدث بينكما) بشكل إجباري ومكثف في سطر أو سطرين فقط وبدون أي حشو، ليتم تخزينه في قسم "ملخص القصة" والذاكرة التراكمية الدائمة للجولات القادمة.
5. في حقل "daysPassed": أعد 0 في الحالات العادية، أو 1 (أو أكثر) إذا تضمن قرار اللاعب النوم، المبيت، التخييم، أو مسيراً يستغرق أياماً.`;

      const userMessage = `--- سجل ملخص القصة التراكمي وذاكرة الأحداث السابقة (مرجعك الإجباري): ---
${memoryText}

--- بيانات اللاعب والموقع الحالي: ---
- الاسم: ${p.name || 'مسافر التربة'}
- الموقع: ${p.current_landmark || 'المدينة العظيمة'}
- اليوم: ${w.day || 1} | المستوى: ${p.level || 1} (${p.rank || 'أفق الولادة'})
- الصحة: ${p.hp_current || 100}/${p.hp_max || 100} | الطاقة: ${p.ap_current || 100}/${p.ap_max || 100}
- السلاح المجهز: ${p.weapon_equipped || 'لا يوجد'} | الدرع المجهز: ${p.armor_equipped || 'لا يوجد'}
- الطائفة: ${p.faction_rank ? `${p.faction_rank} في ${p.faction_id}` : 'مقاتل حر بدون انتماء'}
- رصيد العملات: 🪙${p.currency?.G || 0} ذهب, 🥈${p.currency?.S || 0} فضة, 🥉${p.currency?.C || 0} نحاس

--- قرار اللاعب الجديد في هذه الجولة: ---
"${prompt}"

أنتج كائناً يحتوي السرد (narrative)، والملخص الإجباري في سطرين بدون حشو (summary)، وعدد الأيام (daysPassed).`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: userMessage,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              narrative: {
                type: Type.STRING,
                description: 'السرد الدرامي الملحمي لما حدث رداً على قرار اللاعب باللغة العربية الفصحى (2 إلى 4 أسطر)'
              },
              summary: {
                type: Type.STRING,
                description: 'تلخيص إجباري ومكثف جداً في سطر أو سطرين فقط لما دار في هذه الجولة (قرار اللاعب والنتيجة الصافية) لحفظه في سجل ملخص القصة لمنع النسيان'
              },
              daysPassed: {
                type: Type.INTEGER,
                description: 'عدد الأيام المنقضية (1 أو أكثر إذا تضمن القرار نوماً أو مسيراً، و0 خلاف ذلك)'
              }
            },
            required: ['narrative', 'summary', 'daysPassed']
          }
        }
      });

      const raw = response.text || '';
      let parsed = { narrative: '', summary: '', daysPassed: 0 };
      try {
        parsed = JSON.parse(raw);
      } catch (jsonErr) {
        const clean = raw.replace(/```json/gi, '').replace(/```/gi, '').trim();
        try {
          parsed = JSON.parse(clean);
        } catch {
          parsed = {
            narrative: raw.trim(),
            summary: `قام اللاعب بـ: "${prompt}".`,
            daysPassed: /نوم|مبيت|نزل|أنام|تخييم/i.test(prompt) ? 1 : 0
          };
        }
      }

      const content = parsed.narrative || parsed.summary || 'مضت الأحداث وبلغت مرادك في أرجاء القارة.';
      const summary = parsed.summary || `قام اللاعب بـ: "${prompt}".`;
      const daysPassed = typeof parsed.daysPassed === 'number' ? parsed.daysPassed : 0;

      res.json({
        content,
        summary,
        updates: { daysPassed }
      });
    } catch (err: any) {
      console.error('Narrate API Error:', err);
      const prompt = req.body?.prompt || 'قرار';
      const landmark = req.body?.gameState?.player?.current_landmark || 'المنطقة';
      const isRest = /نوم|مبيت|نزل|أنام|تخييم/i.test(prompt);
      res.json({
        content: `استجابت وقائع [${landmark}] لقرارك: "${prompt}".\nعبرت ساعات اليوم بهدوء وتأمل، محققاً خطوتك في أرجاء القارة بسلام.`,
        summary: `قام اللاعب بـ: "${prompt}" في [${landmark}].`,
        updates: { daysPassed: isRest ? 1 : 0 }
      });
    }
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
}

startServer();
