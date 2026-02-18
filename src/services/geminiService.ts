import { SiteConfig } from "../types";

// --- CONFIGURATION ---
// On utilise import.meta.env pour Vite
const getApiKey = () => import.meta.env.VITE_GEMINI_KEY || "";
// APRÈS ✅
const MODEL_NAME = "gemini-2.0-flash";

// --- OUTILS INTERNES ---
const cleanJSON = (text: string) => {
  if (!text) return null;
  try { 
    // Nettoie les balises markdown ```json ... ```
    return JSON.parse(text.replace(/```json|```/g, "").trim()); 
  } catch (e) { 
    return null; 
  }
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        const result = reader.result as string;
        // On garde uniquement la partie base64 après la virgule
        resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const callGeminiAPI = async (payload: any) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("⛔ CLÉ API MANQUANTE DANS .ENV");
    return null;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`,
      { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify(payload) 
      }
    );

    if (!response.ok) {
      console.error(`Erreur API Gemini: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (error) { 
    console.error("Erreur réseau:", error);
    return null; 
  }
};

// ============================================================================
// FONCTIONS EXPORTÉES (CELLES QUE APP.TSX RÉCLAME)
// ============================================================================

// 1. MAJORDOME AGENT (Chat + Actions)
export const askButlerAgent = async (history: { role: string, text: string }[], contextData: any) => {
  const prompt = `
    Tu es le Majordome de la maison.
    Si l'utilisateur veut ajouter un article aux courses ou au frigo, réponds UNIQUEMENT avec ce JSON : 
    {"action": "ADD_HUB", "item": "Nom de l'article", "reply": "Bien monsieur, j'ai ajouté [article] à la liste."}
    Sinon, réponds normalement en texte pour converser.
  `;
  
  const contents = [
      { role: "user", parts: [{ text: prompt }] },
      ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] }))
  ];

  const res = await callGeminiAPI({ contents });
  
  // On tente de lire si c'est une action
  const json = cleanJSON(res);
  if (json && json.action) {
    return { type: 'action', data: json };
  }
  return { type: 'text', data: res || "Je n'ai pas compris." };
};

// 2. CHAT SIMPLE (Fallback)
export const askAIChat = async (history: { role: string, text: string }[]) => {
  const res = await askButlerAgent(history, {});
  return res.type === 'text' ? res.data : "Action effectuée.";
};

// 3. SCANNER CODE BARRE (Vision)
export const readBarcodeFromImage = async (file: File) => {
  try {
    const b64 = await fileToBase64(file);
    const text = await callGeminiAPI({ 
      contents: [{ 
        parts: [
          { text: "Lis UNIQUEMENT les chiffres du code barre visible sur cette image. Renvoie seulement la suite de chiffres. Si illisible, renvoie NULL." }, 
          { inline_data: { mime_type: file.type, data: b64 } }
        ] 
      }] 
    });
    // Nettoyage pour ne garder que les chiffres
    const digits = text ? text.replace(/\D/g, '') : null;
    return (digits && digits.length > 5) ? digits : null;
  } catch (e) { return null; }
};

// 4. SCANNER PRODUIT FRAIS (Vision)
export const scanProductImage = async (file: File) => {
  try {
    const b64 = await fileToBase64(file);
    const res = await callGeminiAPI({ 
      contents: [{ 
        parts: [
          { text: "Identifie ce produit alimentaire. Renvoie un JSON strict : { \"name\": \"Nom du produit\", \"category\": \"Frais/Épicerie/Légume...\", \"expiryDate\": \"YYYY-MM-DD\" (Estime une date de péremption logique si non visible) }" }, 
          { inline_data: { mime_type: file.type, data: b64 } }
        ] 
      }] 
    });
    return cleanJSON(res);
  } catch (e) { return null; }
};

// 5. IMPORTATEUR DE RECETTES
export const extractRecipeFromUrl = async (url: string) => {
  const res = await callGeminiAPI({ 
    contents: [{ 
      parts: [{ text: `Analyse ce texte ou cette URL : "${url}". Extrais la recette sous forme de JSON strict : { "title": "Titre", "chef": "Auteur", "category": "plat/dessert", "ingredients": "Liste textuelle ingrédients", "steps": "Étapes de préparation" }` }] 
    }] 
  });
  return cleanJSON(res);
};

// 6. ARCHITECTE (Design)
export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  const res = await callGeminiAPI({ 
    contents: [{ 
      parts: [{ text: `En tant qu'expert UI, modifie cette configuration JSON selon la demande : "${prompt}". Renvoie uniquement le JSON modifié. Config actuelle : ${JSON.stringify(currentConfig)}` }] 
    }] 
  });
  const json = cleanJSON(res);
  return json ? { ...currentConfig, ...json } : null;
};
