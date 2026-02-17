import { SiteConfig } from "../types";

const apiKey = import.meta.env.VITE_GEMINI_KEY || "";
const MODEL_NAME = "gemini-1.5-flash"; 

const callGeminiAPI = async (payload: any) => {
  if (!apiKey) return null;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (error) {
    console.error("Erreur Gemini:", error);
    return null;
  }
};

const cleanAndParseJSON = (text: string) => {
  if (!text) return null;
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) {
    return null;
  }
};

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  const protectedConfig = { ...currentConfig, welcomeImage: "(Ignoré)", homeHtml: "(Protégé)", cookingHtml: "(Protégé)" };
  const finalPrompt = `Agis comme un architecte UI. Config: ${JSON.stringify(protectedConfig)}. Demande: "${prompt}". Renvoie UN JSON valide avec les champs modifiés (primaryColor, backgroundColor, fontFamily, welcomeTitle, welcomeText, welcomeImage). Ne touche pas aux champs protégés.`;
  
  const responseText = await callGeminiAPI({ contents: [{ parts: [{ text: finalPrompt }] }] });
  const newConfig = cleanAndParseJSON(responseText);

  if (newConfig) {
    if (!newConfig.welcomeImage || newConfig.welcomeImage === "(Ignoré)") newConfig.welcomeImage = currentConfig.welcomeImage;
    newConfig.homeHtml = currentConfig.homeHtml;       
    newConfig.cookingHtml = currentConfig.cookingHtml; 
    return { ...currentConfig, ...newConfig };
  }
  return null;
};

// MAJORDOME AMÉLIORÉ (Avec détection d'action)
export const askAIChat = async (history: { role: string, text: string }[]) => {
  const contents = history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] }));
  const systemContext = {
    role: "user",
    parts: [{ text: "Tu es le Majordome de la famille. Tu peux ajouter des courses. Si l'utilisateur te demande d'ajouter un article (ex: 'ajoute du lait'), réponds EXACTEMENT et UNIQUEMENT : [ADD_SHOP:Lait]. Ne dis rien d'autre. S'il ne demande pas d'ajout, réponds normalement et poliment." }]
  };
  const response = await callGeminiAPI({ contents: [systemContext, ...contents] });
  return response || "Désolé, je suis momentanément indisponible.";
};

export const extractRecipeFromUrl = async (url: string) => {
  const prompt = `Analyse ceci: ${url}. Renvoie UN JSON: {"title": "Nom","chef": "Auteur","category": "plat","ingredients": "ing1\\ning2","steps": "etape1"}`;
  const response = await callGeminiAPI({ contents: [{ parts: [{ text: prompt }] }] });
  return cleanAndParseJSON(response);
};

export const scanProductImage = async (file: File) => {
  try {
    const base64Data = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(file);
    });
    const prompt = `Analyse cette image de produit alimentaire. Renvoie UN JSON valide: {"name": "Nom du produit", "expiryDate": "YYYY-MM-DD"}. Estime une date logique (Frais = +7j, Sec = +1an) si tu ne la vois pas.`;
    const response = await callGeminiAPI({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: file.type, data: base64Data } }] }]
    });
    return cleanAndParseJSON(response);
  } catch (error) { return null; }
};
