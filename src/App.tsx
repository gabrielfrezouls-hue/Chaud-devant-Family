/**
 * CHAUD DEVANT - APP.TSX
 * Version : MASTER INTEGRAL
 * Description : Application familiale de gestion (Courses, Frigo, Recettes, Finances, Tâches)
 * Fonctionnalités IA : Majordome Actif, Scanner Visuel, Lecteur Code-Barre, Importateur de Recettes.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, updateDoc, 
  where, getDoc, arrayUnion, arrayRemove 
} from 'firebase/firestore';

// ICÔNES (LUCIDE REACT)
import { 
  Menu, X, Home, ChefHat, Wallet, PiggyBank,
  Calendar as CalIcon, Settings, Code, Sparkles, Send, History,
  MessageSquare, ChevronRight, LogIn, Loader2, ShieldAlert, RotateCcw, ArrowLeft, Trash2, Pencil,
  CheckSquare, Square, CheckCircle2, Plus, Minus, Clock, Save, Image as ImageIcon, 
  Map, QrCode, Star, Maximize2, Minimize2, Link, Copy, LayoutDashboard, ShoppingCart, StickyNote, Users, 
  ShoppingBag, Bell, Mail, CornerDownRight, Store, CalendarClock, ScanBarcode, Camera, Zap, UtensilsCrossed, 
  LogOut, ToggleLeft, ToggleRight, Upload, AlertTriangle, ArrowRight, Heart, Info, XCircle, Check
} from 'lucide-react';

// TYPES
import { Recipe, FamilyEvent, ViewType, SiteConfig, SiteVersion } from './types';

// SERVICES (Assurez-vous que geminiService.ts contient bien ces exports)
import { 
    askAIArchitect, 
    askAIChat, 
    extractRecipeFromUrl, 
    scanProductImage, 
    askButlerAgent, 
    readBarcodeFromImage 
} from './services/geminiService';

// COMPOSANTS INTERNES
import Background from './components/Background';
import RecipeCard from './components/RecipeCard';

// ============================================================================
// 1. CONSTANTES & CONFIGURATION GLOBALE
// ============================================================================

const ADMIN_EMAIL = "gabriel.frezouls@gmail.com";
const APP_NAME = "CHAUD DEVANT";

// Définition statique pour éviter les erreurs de référence
const NAV_ITEMS = {
    home: "ACCUEIL",
    hub: "LE TABLEAU",
    fridge: "FRIGO & SCAN",
    cooking: "SEMAINIER",
    recipes: "LIVRE RECETTES",
    calendar: "AGENDA",
    tasks: "CORVÉES",
    wallet: "COMPTES",
    xsite: "XSITE"
};

// Liste étendue pour l'autocomplétion des lieux d'achat
const COMMON_STORES = [
    "Auchan", "Lidl", "Carrefour", "Leclerc", "Grand Frais", "Intermarché", "Super U", "Monoprix", "Franprix",
    "Marché", "Drive", "Biocoop", "Picard", "Thiriet", "La Vie Claire", "Naturalia",
    "Action", "Gifi", "La Foir'Fouille", "Hema", "Flying Tiger",
    "Pharmacie", "Boulangerie", "Boucherie", "Tabac/Presse", "Fromager", "Primeur",
    "Amazon", "Cdiscount", "Relais Colis", "La Poste",
    "Leroy Merlin", "Castorama", "Brico Dépôt", "IKEA", "Jardinerie", "Truffaut",
    "Cultura", "Fnac", "Boulanger", "Darty", "Apple Store",
    "Decathlon", "Intersport", "Go Sport",
    "Sephora", "Nocibé", "Marionnaud",
    "Zara", "H&M", "Kiabi", "Vinted", "Uniqlo", "Primark"
];

const ORIGINAL_CONFIG: SiteConfig = {
  primaryColor: '#a85c48',
  backgroundColor: '#f5ede7',
  fontFamily: 'Montserrat',
  welcomeTitle: 'CHAUD DEVANT',
  welcomeText: "Bienvenue dans l'espace sacré de notre famille.",
  welcomeImage: 'https://images.unsplash.com/photo-1556910103-1c02745a30bf?q=80&w=2070&auto=format&fit=crop',
  navigationLabels: NAV_ITEMS,
  homeHtml: '', 
  cookingHtml: ''
};

// Rotation des tâches ménagères
const ROTATION = ['G', 'P', 'V']; // Gabriel, Pauline, Valentin
const REF_DATE = new Date('2025-12-20T12:00:00'); // Date pivot pour le calcul

// ============================================================================
// 2. UTILITAIRES & LOGIQUE MÉTIER
// ============================================================================

interface AppNotification {
    id: string; message: string; type: 'info' | 'alert' | 'fun'; repeat: 'once' | 'daily' | 'monthly'; targets: string[]; scheduledFor?: string; linkView?: string; linkId?: string; createdAt: string; readBy: Record<string, string>; 
}

// Fonction de catégorisation intelligente (Regex simple)
const categorizeShoppingItem = (text: string) => {
    const lower = text.toLowerCase();
    
    // Frais
    if (/(lait|beurre|yaourt|creme|oeuf|fromage|skyr|mozarella|comte|emmental)/.test(lower)) return 'Frais & Crèmerie';
    // Fruits & Légumes
    if (/(pomme|banane|legume|fruit|salade|tomate|carotte|oignon|ail|echalote|avocat|citron)/.test(lower)) return 'Primeur';
    // Protéines
    if (/(viande|poulet|poisson|jambon|steak|lardon|saucisse|dinde|boeuf|thon|saumon)/.test(lower)) return 'Boucherie/Poisson';
    // Boulangerie
    if (/(pain|baguette|brioche|croissant|pain de mie|burger|tortilla)/.test(lower)) return 'Boulangerie';
    // Épicerie Salée
    if (/(pates|riz|conserve|huile|vinaigre|moutarde|sel|poivre|epice|sauce|mayo|ketchup|bocal|thon|sardine)/.test(lower)) return 'Épicerie Salée';
    // Épicerie Sucrée
    if (/(sucre|farine|chocolat|gateau|biscuit|cereale|miel|confiture|nutella|bonbon)/.test(lower)) return 'Épicerie Sucrée';
    // Boissons
    if (/(coca|jus|vin|biere|eau|sirop|soda|alcool|cafe|the|tisane)/.test(lower)) return 'Boissons';
    // Hygiène
    if (/(shampoing|savon|dentifrice|papier|toilette|douche|cosmetique|coton|rasoir|deo|brosse)/.test(lower)) return 'Hygiène & Beauté';
    // Maison
    if (/(lessive|produit|eponge|sac|poubelle|nettoyant|vaisselle|javel|sopalin)/.test(lower)) return 'Entretien Maison';
    // Animaux
    if (/(chat|chien|croquette|patee|litiere)/.test(lower)) return 'Animaux';
    // Surgelés
    if (/(glace|surgeles|pizza|frite|poelee)/.test(lower)) return 'Surgelés';
    // Pharmacie
    if (/(medicament|doliprane|pansement|sirop|vitamine)/.test(lower)) return 'Pharmacie';
    
    return 'Divers';
};

// Appel API OpenFoodFacts (Utilisé après lecture du code barre)
const fetchProductByBarcode = async (barcode: string) => {
    try {
        const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
        const data = await response.json();
        if (data.status === 1) {
            return {
                name: data.product.product_name_fr || data.product.product_name,
                image: data.product.image_front_small_url,
                brand: data.product.brands,
                nutriscore: data.product.nutriscore_grade,
                category: categorizeShoppingItem(data.product.product_name_fr || '')
            };
        }
        return null;
    } catch (e) { 
        console.error("Erreur API OpenFoodFacts:", e); 
        return null; 
    }
};

// Calculateur de tâches ménagères (Rotation hebdomadaire)
const getChores = (date: Date) => {
  const saturday = new Date(date);
  // Se caler sur le samedi précédent ou courant
  saturday.setDate(date.getDate() - (date.getDay() + 1) % 7);
  saturday.setHours(12, 0, 0, 0);
  
  const weekId = `${saturday.getDate()}-${saturday.getMonth()+1}-${saturday.getFullYear()}`;
  
  // Différence en semaines depuis la date de référence
  const diffTime = saturday.getTime() - REF_DATE.getTime();
  const diffWeeks = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 7));
  
  // Modulo 3 pour la rotation des 3 personnes
  const mod = (n: number, m: number) => ((n % m) + m) % m;
  
  return { 
      id: weekId, 
      fullDate: saturday, 
      dateStr: `${saturday.getDate()}/${saturday.getMonth()+1}`, 
      haut: ROTATION[mod(diffWeeks, 3)], 
      bas: ROTATION[mod(diffWeeks + 2, 3)], 
      douche: ROTATION[mod(diffWeeks + 1, 3)] 
  };
};

const getMonthWeekends = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const weekends = [];
  const date = new Date(year, month, 1);
  
  // Trouver le premier samedi
  while (date.getDay() !== 6) { date.setDate(date.getDate() + 1); }
  
  // Boucler sur le mois
  while (date.getMonth() === month) {
    weekends.push(getChores(new Date(date)));
    date.setDate(date.getDate() + 7);
  }
  return weekends;
};

// ============================================================================
// 3. COMPOSANTS D'INTERFACE (ATOMES UI)
// ============================================================================

// Menu Latéral (Drawer)
const SideMenu = ({ config, isOpen, close, setView, logout }: any) => (
  <div className={`fixed inset-0 z-[60] ${isOpen ? '' : 'pointer-events-none'}`}>
    {/* Overlay sombre */}
    <div 
        className={`absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-500 ${isOpen ? 'opacity-100' : 'opacity-0'}`} 
        onClick={() => close(false)} 
    />
    {/* Drawer */}
    <div 
        className={`absolute right-0 top-0 h-full w-80 bg-[#f5ede7] p-8 transition-transform duration-500 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'} overflow-y-auto shadow-2xl border-l border-white/50 flex flex-col`}
        style={{ backgroundColor: config.backgroundColor }}
    >
      <div className="flex justify-end mb-8">
          <button onClick={() => close(false)} className="p-3 bg-white rounded-full shadow-sm hover:scale-110 transition-transform"><X size={20} className="text-gray-500"/></button>
      </div>
      
      <div className="space-y-3 flex-1">
        <h4 className="text-xs font-black uppercase text-gray-400 tracking-widest mb-4 ml-2">Navigation</h4>
        {Object.keys(NAV_ITEMS).filter(k => k !== 'edit').map(key => (
          <button key={key} onClick={() => { setView(key); close(false); }} className="w-full text-left p-4 bg-white/50 rounded-2xl hover:bg-white hover:shadow-md transition-all uppercase font-black text-xs tracking-widest text-gray-600 hover:text-black flex items-center justify-between group">
            {NAV_ITEMS[key as keyof typeof NAV_ITEMS]}
            <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity transform group-hover:translate-x-1"/>
          </button>
        ))}
      </div>

      <div className="mt-8 border-t border-gray-200 pt-8 space-y-3">
        <h4 className="text-xs font-black uppercase text-gray-400 tracking-widest mb-4 ml-2">Système</h4>
        <button onClick={() => { setView('edit'); close(false); }} className="w-full text-left p-4 bg-gray-100 rounded-2xl hover:bg-gray-200 transition-all uppercase font-black text-xs tracking-widest text-gray-600 flex items-center gap-3">
            <Settings size={16}/> Administration
        </button>
        <button onClick={logout} className="w-full text-left p-4 bg-red-50 text-red-400 rounded-2xl hover:bg-red-100 transition-all uppercase font-black text-xs tracking-widest flex items-center gap-3">
            <LogOut size={16}/> Déconnexion
        </button>
      </div>
    </div>
  </div>
);

// Navigation Mobile (Bottom Bar)
const BottomNav = ({ config, view, setView }: any) => (
  <div className="md:hidden fixed bottom-6 left-6 right-6 h-20 bg-white/90 backdrop-blur-xl rounded-[2.5rem] z-40 px-2 flex justify-between items-center shadow-2xl border border-white/50">
    {[ 
        {id:'home', i:<Home size={24}/>}, 
        {id:'hub', i:<LayoutDashboard size={24}/>}, 
        {id:'fridge', i:<UtensilsCrossed size={24}/>}, 
        {id:'recipes', i:<ChefHat size={24}/>}, 
        {id:'wallet', i:<Wallet size={24}/>} 
    ].map(b => (
        <button 
            key={b.id} 
            onClick={() => setView(b.id)} 
            className={`w-14 h-14 flex items-center justify-center rounded-full transition-all duration-300 ${view === b.id ? 'bg-black text-white -translate-y-4 shadow-xl scale-110' : 'text-gray-400 hover:bg-gray-100'}`}
        >
            {b.i}
        </button>
    ))}
  </div>
);

// Carte Dashboard (Gros Boutons)
const HomeCard = ({ icon, title, label, onClick, color }: any) => (
  <div onClick={onClick} className="bg-white/80 backdrop-blur-md p-8 rounded-[3rem] cursor-pointer hover:scale-[1.02] transition-transform duration-300 shadow-xl border border-white/60 group flex flex-col justify-between h-64 relative overflow-hidden">
    <div className="absolute -right-10 -top-10 w-40 h-40 bg-gradient-to-br from-gray-100 to-transparent rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
    <div style={{ color }} className="mb-4 transform group-hover:scale-110 transition-transform duration-300 p-4 bg-gray-50 rounded-2xl w-fit group-hover:bg-white group-hover:shadow-md">{icon}</div>
    <div className="relative z-10">
        <h3 className="text-2xl font-cinzel font-black mb-2 uppercase text-gray-800 leading-tight">{title}</h3>
        <p className="text-[10px] font-bold tracking-[0.2em] opacity-60 uppercase flex items-center gap-2 text-gray-600 bg-gray-100/50 w-fit px-3 py-1 rounded-full">{label} <ChevronRight size={10}/></p>
    </div>
  </div>
);

// Cellule du tableau de tâches
const TaskCell = ({ weekId, letter, label, isLocked, choreStatus, toggleChore, myLetter }: any) => {
  const isDone = choreStatus[weekId]?.[letter] || false; 
  const canCheck = !isLocked && myLetter === letter; 
  return (
    <td className="p-4 text-center align-middle">
      <div className="flex flex-col items-center gap-2 group">
        <span className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shadow-sm transition-all ${isDone ? 'bg-green-100 text-green-700 scale-110' : 'bg-gray-100 text-gray-500'}`}> {letter} </span>
        <button 
            onClick={() => canCheck && toggleChore(weekId, letter)} 
            disabled={!canCheck} 
            className={`transition-all active:scale-90 p-2 rounded-full hover:bg-gray-50 ${!canCheck && !isDone ? 'opacity-20 cursor-not-allowed' : ''}`} 
            title={isLocked ? "Trop tôt !" : "Cocher"}
        >
          {isDone ? <CheckSquare className="text-green-500 fill-green-50" size={28} /> : (canCheck ? <Square className="text-gray-400 hover:text-green-500" size={28} /> : <Square className="text-gray-200" size={28} />)}
        </button>
      </div>
    </td>
  );
};

// Graphique Liquid (Jauge Visuelle)
const CircleLiquid = ({ fillPercentage }: { fillPercentage: number }) => {
  const safePercent = isNaN(fillPercentage) ? 0 : Math.min(Math.max(fillPercentage, 0), 100);
  const size = 240; const radius = 100; const center = size / 2;
  const liquidHeight = (safePercent / 100) * size;
  const liquidY = size - liquidHeight;
  return (
    <div className="relative w-full h-full flex justify-center items-center py-6">
        <svg viewBox={`0 0 ${size} ${size}`} className="w-64 h-64 drop-shadow-2xl overflow-visible">
            <defs>
                <clipPath id="circleClip"><circle cx={center} cy={center} r={radius} /></clipPath>
                <linearGradient id="liquidGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#fbbf24" /><stop offset="100%" stopColor="#d97706" /></linearGradient>
            </defs>
            <circle cx={center} cy={center} r={radius} fill="#fffbeb" stroke="none" /> 
            <rect x="0" y={liquidY} width={size} height={liquidHeight} fill="url(#liquidGrad)" clipPath="url(#circleClip)" className="transition-all duration-1000 ease-in-out" />
            <circle cx={center} cy={center} r={radius} fill="none" stroke="#f59e0b" strokeWidth="8" strokeOpacity="0.2" />
        </svg>
    </div>
  );
};

// Majordome Flottant (Chat + Actions)
const ButlerFloating = ({ chatHistory, setChatHistory, isAiLoading, setIsAiLoading, onAction }: any) => {
    const [isOpen, setIsOpen] = useState(false);
    const [msg, setMsg] = useState('');
    const bottomRef = useRef<HTMLDivElement>(null);

    // Scroll auto vers le bas
    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatHistory, isOpen]);

    const handleChat = async () => {
        if (!msg.trim()) return;
        const h = [...chatHistory, { role: 'user', text: msg }];
        setChatHistory(h); setMsg(''); setIsAiLoading(true);
        
        // Appel Service
        const response = await askButlerAgent(h, {});
        
        if (response.type === 'action') {
            // ACTION DÉTECTÉE PAR L'IA (ex: "Ajoute du lait")
            if (response.data.action === 'ADD_HUB') {
                onAction('shop', response.data.item);
            }
            setChatHistory([...h, { role: 'model', text: response.data.reply || "C'est fait, monsieur." }]);
        } else {
            // RÉPONSE TEXTE CLASSIQUE
            setChatHistory([...h, { role: 'model', text: response.data }]);
        }
        setIsAiLoading(false);
    };

    return (
        <div className="fixed bottom-28 md:bottom-12 right-6 z-[200] flex flex-col items-end pointer-events-none">
            {isOpen && (
                <div className="pointer-events-auto w-80 h-[500px] bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/50 flex flex-col mb-6 animate-in slide-in-from-bottom-10 origin-bottom-right overflow-hidden">
                    <div className="p-5 border-b bg-gray-50/50 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-black rounded-full flex items-center justify-center"><Sparkles size={14} className="text-yellow-400"/></div>
                            <span className="font-cinzel font-bold text-sm">Majordome</span>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200"><X size={16}/></button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {chatHistory.length === 0 && (
                            <div className="text-center text-xs text-gray-400 mt-10 italic px-4">
                                "Je suis à votre service. Demandez-moi d'ajouter des courses, une idée de recette ou une blague."
                            </div>
                        )}
                        {chatHistory.map((c:any, i:number) => (
                            <div key={i} className={`p-3 rounded-2xl text-xs max-w-[85%] leading-relaxed shadow-sm ${c.role === 'user' ? 'bg-black text-white ml-auto rounded-tr-sm' : 'bg-white border border-gray-100 mr-auto rounded-tl-sm text-gray-600'}`}>
                                {c.text}
                            </div>
                        ))}
                        {isAiLoading && (
                            <div className="mr-auto bg-gray-50 p-3 rounded-2xl rounded-tl-sm border"><Loader2 className="animate-spin text-gray-400" size={16}/></div>
                        )}
                        <div ref={bottomRef} />
                    </div>

                    <div className="p-3 border-t bg-white">
                        <div className="flex gap-2 items-center bg-gray-50 p-1 rounded-[1.5rem] border border-gray-200 focus-within:border-black transition-colors">
                            <input 
                                value={msg} 
                                onChange={e => setMsg(e.target.value)} 
                                onKeyDown={e => e.key === 'Enter' && handleChat()} 
                                placeholder="Votre demande..." 
                                className="flex-1 text-xs p-3 bg-transparent outline-none font-medium ml-2" 
                            />
                            <button onClick={handleChat} disabled={!msg.trim()} className="p-3 bg-black text-white rounded-full hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100">
                                <ArrowRight size={14}/>
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            <button onClick={() => setIsOpen(!isOpen)} className="pointer-events-auto w-16 h-16 bg-black text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-110 transition-transform active:scale-95 border-4 border-[#f5ede7] group">
                {isOpen ? <X size={24}/> : <MessageSquare size={24} className="group-hover:animate-pulse"/>}
            </button>
        </div>
    );
};

// ============================================================================
// 4. LES VUES (CONTENU PRINCIPAL)
// ============================================================================

// --- VUE FRIGO (SCANNER HYBRIDE) ---
const FridgeView = () => {
    const [items, setItems] = useState<any[]>([]);
    const [scanning, setScanning] = useState(false);
    const [scanType, setScanType] = useState<'barcode' | 'vision' | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const barcodeRef = useRef<HTMLInputElement>(null);
    const [manualEntry, setManualEntry] = useState({ name: '', expiry: '' });
    
    useEffect(() => { 
        const u = onSnapshot(query(collection(db, 'fridge_items'), orderBy('expiryDate', 'asc')), (s) => setItems(s.docs.map(d => ({id:d.id, ...d.data()})))); 
        return () => u(); 
    }, []);

    const handleScan = async (e: any, mode: 'product' | 'barcode') => {
        const f = e.target.files[0]; 
        // Reset input
        e.target.value = null; 
        if(!f) return;

        setScanning(true);
        setScanType(mode === 'barcode' ? 'barcode' : 'vision');
        
        try {
            let res: any = null;
            if (mode === 'barcode') {
                // 1. Lire chiffres
                const code = await readBarcodeFromImage(f);
                if(code) {
                    // 2. Chercher produit
                    res = await fetchProductByBarcode(code);
                    if(res) {
                        // Date par défaut J+7 pour les produits scannés
                        res.expiryDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
                        alert(`Trouvé : ${res.name}`);
                    } else {
                        alert(`Code ${code} lu, mais produit inconnu.`);
                    }
                } else {
                    alert("Impossible de lire le code-barres sur l'image. Essayez de vous rapprocher.");
                }
            } else {
                // 1. Vision IA
                res = await scanProductImage(f);
                if(res) alert(`Identifié : ${res.name}`);
            }

            if(res) {
                await addDoc(collection(db, 'fridge_items'), { 
                    ...res, 
                    addedAt: new Date().toISOString(),
                    // Si pas de date, on met une date loin par sécurité
                    expiryDate: res.expiryDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
                });
            }
        } catch(err) {
            console.error(err);
            alert("Erreur lors de l'analyse.");
        }
        
        setScanning(false);
        setScanType(null);
    };

    return (
        <div className="space-y-8 animate-in fade-in pb-32">
            
            {/* ZONE SCANNER */}
            <div className="grid grid-cols-2 gap-6">
                <button onClick={() => barcodeRef.current?.click()} className="relative overflow-hidden p-8 bg-white rounded-[2.5rem] shadow-xl border border-gray-100 flex flex-col items-center gap-4 hover:scale-105 transition-transform group">
                    <div className="absolute inset-0 bg-blue-50 opacity-0 group-hover:opacity-100 transition-opacity"/>
                    <div className="relative w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        {scanning && scanType === 'barcode' ? <Loader2 className="animate-spin"/> : <ScanBarcode size={32}/>}
                    </div>
                    <span className="relative font-black text-xs uppercase tracking-widest text-center text-gray-600 group-hover:text-blue-600">Code-Barre<br/>(Photo)</span>
                </button>
                
                <button onClick={() => fileRef.current?.click()} className="relative overflow-hidden p-8 bg-white rounded-[2.5rem] shadow-xl border border-gray-100 flex flex-col items-center gap-4 hover:scale-105 transition-transform group">
                    <div className="absolute inset-0 bg-orange-50 opacity-0 group-hover:opacity-100 transition-opacity"/>
                    <div className="relative w-16 h-16 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center group-hover:bg-orange-600 group-hover:text-white transition-colors">
                        {scanning && scanType === 'vision' ? <Loader2 className="animate-spin"/> : <Camera size={32}/>}
                    </div>
                    <span className="relative font-black text-xs uppercase tracking-widest text-center text-gray-600 group-hover:text-orange-600">Vision IA<br/>(Photo)</span>
                </button>

                <input type="file" ref={barcodeRef} accept="image/*" capture="environment" className="hidden" onChange={e => handleScan(e, 'barcode')} />
                <input type="file" ref={fileRef} accept="image/*" capture="environment" className="hidden" onChange={e => handleScan(e, 'product')} />
            </div>

            {/* AJOUT MANUEL */}
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100">
                <h3 className="font-bold text-xs uppercase tracking-widest text-gray-400 mb-4 ml-2">Ajout Manuel</h3>
                <div className="flex gap-2">
                    <input value={manualEntry.name} onChange={e => setManualEntry({...manualEntry, name: e.target.value})} placeholder="Produit..." className="flex-1 p-4 bg-gray-50 rounded-2xl font-bold text-sm outline-none focus:ring-2 ring-black/5"/>
                    <input type="date" value={manualEntry.expiry} onChange={e => setManualEntry({...manualEntry, expiry: e.target.value})} className="p-4 bg-gray-50 rounded-2xl font-bold text-sm outline-none focus:ring-2 ring-black/5"/>
                    <button onClick={async () => { if(manualEntry.name) { await addDoc(collection(db, 'fridge_items'), { name: manualEntry.name, category: categorizeShoppingItem(manualEntry.name), addedAt: new Date().toISOString(), expiryDate: manualEntry.expiry || new Date().toISOString().split('T')[0] }); setManualEntry({name:'', expiry:''}); }}} className="p-4 bg-black text-white rounded-2xl shadow-lg hover:scale-105 transition-transform"><Plus/></button>
                </div>
            </div>

            {/* LISTE PRODUITS */}
            <div className="space-y-3">
                {items.length === 0 && <div className="text-center py-10 opacity-40 italic">Le frigo est vide... pour l'instant.</div>}
                {items.map(item => {
                    const diff = Math.ceil((new Date(item.expiryDate).getTime() - new Date().getTime()) / 86400000);
                    const isExpired = diff < 0;
                    const isUrgent = diff >= 0 && diff <= 3;
                    
                    return (
                        <div key={item.id} className={`p-5 rounded-[2rem] flex justify-between items-center transition-all ${isExpired ? 'bg-red-50 border border-red-100' : 'bg-white border border-gray-100 shadow-sm'}`}>
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${isExpired ? 'bg-red-100 text-red-600' : (isUrgent ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600')}`}>
                                    {isExpired ? '!' : diff}
                                </div>
                                <div>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">{item.category}</span>
                                    <h4 className={`font-bold text-lg leading-none ${isExpired ? 'text-red-800 line-through' : 'text-gray-800'}`}>{item.name}</h4>
                                    <div className="flex items-center gap-1 mt-1 text-xs font-bold text-gray-400">
                                        <Clock size={10}/> {isExpired ? 'Périmé' : (diff === 0 ? "Aujourd'hui" : `Jours restants`)}
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => deleteDoc(doc(db, 'fridge_items', item.id))} className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"><Trash2 size={20}/></button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// --- VUE RECETTES (AVEC LIEN MAGIQUE) ---
const RecipesView = ({ recipes, addRecipeToHub, openEditRecipe, deleteItem, setIsRecipeModalOpen, isRecipeModalOpen, currentRecipe, setCurrentRecipe, updateEntry, addEntry, handleAiRecipe, aiLink, setAiLink, isAiLoading }: any) => {
    return (
        <div className="space-y-10 animate-in fade-in pb-32" id="recipes-list">
             <div className="flex flex-col items-center gap-6 text-center">
                <h2 className="text-4xl font-cinzel font-black text-gray-800">LIVRE DE CUISINE</h2>
                <button onClick={() => setIsRecipeModalOpen(true)} className="bg-black text-white px-8 py-4 rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform flex items-center gap-3 shadow-xl hover:shadow-2xl">
                    <Plus size={20}/> Nouvelle Recette
                </button>
             </div>
             
             {/* MODALE ÉDITION/CRÉATION */}
             {isRecipeModalOpen && (
                <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-2xl rounded-[3rem] p-8 md:p-10 shadow-2xl space-y-6 relative animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
                        <button onClick={() => setIsRecipeModalOpen(false)} className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"><X size={20}/></button>
                        
                        <div className="text-center mb-8">
                            <h3 className="text-2xl font-cinzel font-bold">{currentRecipe.id ? 'Modifier' : 'Ajouter une Recette'}</h3>
                            <p className="text-gray-400 text-sm mt-2">Remplissez les détails ou utilisez l'IA.</p>
                        </div>

                        {/* LIEN MAGIQUE IA */}
                        <div className="p-6 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-[2rem] border border-indigo-100 flex flex-col gap-3 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><Sparkles size={100} className="text-indigo-500"/></div>
                            <label className="text-[10px] font-black uppercase text-indigo-500 flex items-center gap-2"><Zap size={14} className="fill-indigo-500"/> Remplissage Magique par Lien</label>
                            <div className="flex gap-2 relative z-10">
                                <input 
                                    value={aiLink} 
                                    onChange={e => setAiLink(e.target.value)} 
                                    placeholder="Coller une URL (Marmiton, 750g...)" 
                                    className="flex-1 p-4 rounded-xl border-none outline-none text-sm font-bold shadow-sm bg-white focus:ring-2 ring-indigo-200" 
                                />
                                <button onClick={handleAiRecipe} disabled={isAiLoading} className="p-4 bg-indigo-600 text-white rounded-xl shadow-lg hover:scale-105 transition-transform disabled:opacity-50">
                                    {isAiLoading ? <Loader2 className="animate-spin"/> : <Sparkles size={20}/>}
                                </button>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <input value={currentRecipe.title} onChange={e => setCurrentRecipe({...currentRecipe, title: e.target.value})} className="w-full p-5 rounded-2xl bg-gray-50 font-bold text-xl outline-none focus:ring-2 ring-black/5" placeholder="Titre de la recette..." />
                            
                            <div className="flex flex-col md:flex-row gap-4">
                                <input value={currentRecipe.chef} onChange={e => setCurrentRecipe({...currentRecipe, chef: e.target.value})} className="flex-1 p-4 rounded-2xl bg-gray-50 outline-none font-medium" placeholder="Chef (ex: Papa)" />
                                <select value={currentRecipe.category} onChange={e => setCurrentRecipe({...currentRecipe, category: e.target.value})} className="flex-1 p-4 rounded-2xl bg-gray-50 outline-none font-medium appearance-none cursor-pointer">
                                    <option value="entrée">Entrée</option>
                                    <option value="plat">Plat</option>
                                    <option value="dessert">Dessert</option>
                                    <option value="autre">Autre</option>
                                </select>
                            </div>
                            
                            <div className="grid md:grid-cols-2 gap-4">
                                <textarea value={currentRecipe.ingredients} onChange={e => setCurrentRecipe({...currentRecipe, ingredients: e.target.value})} className="w-full p-5 rounded-2xl bg-gray-50 outline-none h-48 font-medium resize-none" placeholder="Ingrédients (un par ligne)..." />
                                <textarea value={currentRecipe.steps} onChange={e => setCurrentRecipe({...currentRecipe, steps: e.target.value})} className="w-full p-5 rounded-2xl bg-gray-50 outline-none h-48 font-medium resize-none" placeholder="Étapes de préparation..." />
                            </div>
                            
                            <button onClick={async () => {
                                if(currentRecipe.title) {
                                    if (currentRecipe.id) await updateEntry('family_recipes', currentRecipe.id, currentRecipe);
                                    else await addEntry('family_recipes', currentRecipe);
                                    setIsRecipeModalOpen(false);
                                }
                            }} className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:scale-[1.01] transition-transform">
                                Sauvegarder la recette
                            </button>
                        </div>
                        <div className="h-4"/>
                    </div>
                </div>
             )}

             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
               {recipes.length === 0 && <div className="col-span-full text-center py-20 text-gray-400 italic">Aucune recette. Ajoutez-en une ou scannez un QR code !</div>}
               {recipes.map((r: any) => (
                 <div key={r.id} className="relative group animate-in fade-in slide-in-from-bottom-5">
                   <div className="absolute top-4 right-4 z-20 flex gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
                      <button onClick={() => addRecipeToHub(r)} className="p-3 bg-white text-orange-500 rounded-full shadow-lg hover:scale-110 transition-transform" title="Ajouter les ingrédients aux courses"><ShoppingBag size={18}/></button>
                      <button onClick={() => openEditRecipe(r)} className="p-3 bg-white text-blue-500 rounded-full shadow-lg hover:scale-110 transition-transform"><Pencil size={18}/></button>
                      <button onClick={() => deleteItem('family_recipes', r.id)} className="p-3 bg-white text-red-500 rounded-full shadow-lg hover:scale-110 transition-transform"><Trash2 size={18}/></button>
                   </div>
                   <RecipeCard recipe={{...r, ingredients: typeof r.ingredients === 'string' ? r.ingredients.split('\n').filter((i:string) => i.trim()!=='') : r.ingredients, instructions: r.steps || r.instructions}} />
                 </div>
               ))}
             </div>
        </div>
    );
};

const HubView = ({ user, config, usersMapping, onAddItem }: any) => {
    const [items, setItems] = useState<any[]>([]);
    const [newItem, setNewItem] = useState('');
    const [store, setStore] = useState('');
    const [showStore, setShowStore] = useState(false);
    const [type, setType] = useState<'shop' | 'note' | 'msg'>('shop');
    
    useEffect(() => { const u = onSnapshot(query(collection(db, 'hub_items'), orderBy('createdAt', 'desc')), (s) => setItems(s.docs.map(d => ({id:d.id, ...d.data()})))); return () => u(); }, []);
    
    const add = () => { if(newItem) { onAddItem('hub_items', { type, content: newItem, category: categorizeShoppingItem(newItem), store: store || 'Divers', author: usersMapping[user.email] || '?', createdAt: new Date().toISOString() }); setNewItem(''); setStore(''); } };
    const filteredStores = COMMON_STORES.filter(s => s.toLowerCase().includes(store.toLowerCase()));

    return (
        <div className="space-y-8 animate-in fade-in pb-24">
             <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-gray-100 sticky top-24 z-30">
                <div className="flex gap-2 mb-4 p-1 bg-gray-50 rounded-2xl">
                    <button onClick={() => setType('shop')} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${type==='shop'?'bg-black text-white shadow-lg':'text-gray-400 hover:bg-gray-100'}`}>Courses</button>
                    <button onClick={() => setType('note')} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${type==='note'?'bg-yellow-400 text-black shadow-lg':'text-gray-400 hover:bg-gray-100'}`}>Notes</button>
                    <button onClick={() => setType('msg')} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${type==='msg'?'bg-blue-500 text-white shadow-lg':'text-gray-400 hover:bg-gray-100'}`}>Message</button>
                </div>
                
                <div className="flex gap-3">
                    <div className="flex-1 relative group">
                        <input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder={type==='shop' ? "Ajouter un produit..." : "Écrire une note..."} className="w-full p-4 rounded-2xl bg-gray-50 font-bold outline-none border-2 border-transparent focus:border-black transition-colors"/>
                    </div>
                    <button onClick={add} className="p-4 bg-black text-white rounded-2xl hover:scale-105 transition-transform shadow-lg"><Plus/></button>
                </div>
                
                {type === 'shop' && (
                    <div className="relative mt-3">
                        <div className="flex items-center bg-gray-50 rounded-2xl px-4 border border-transparent focus-within:border-gray-200 transition-colors">
                            <Store size={16} className="text-gray-400 mr-2"/>
                            <input value={store} onFocus={() => setShowStore(true)} onChange={e => setStore(e.target.value)} placeholder="Magasin (Optionnel)..." className="w-full py-3 bg-transparent text-xs font-bold outline-none text-gray-600"/>
                        </div>
                        {showStore && store && (
                            <div className="absolute top-full left-0 right-0 bg-white shadow-xl rounded-2xl mt-2 max-h-40 overflow-y-auto z-50 border border-gray-100 p-2">
                                {filteredStores.map(s => <div key={s} onClick={() => { setStore(s); setShowStore(false); }} className="p-3 text-xs font-bold hover:bg-gray-50 rounded-xl cursor-pointer">{s}</div>)}
                            </div>
                        )}
                    </div>
                )}
             </div>

             <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                 {items.map(i => (
                     <div key={i.id} className={`p-5 rounded-[2rem] shadow-sm border border-white/60 relative group transition-all duration-300 hover:-translate-y-1 ${i.type==='shop'?'bg-white':i.type==='note'?'bg-yellow-50 rotate-1 hover:rotate-0':'bg-blue-500 text-white'}`}>
                         <button onClick={() => deleteDoc(doc(db, 'hub_items', i.id))} className={`absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-full ${i.type==='msg' ? 'hover:bg-blue-400' : 'hover:bg-gray-100'}`}><X size={14}/></button>
                         
                         {i.type === 'shop' && (
                             <div className="flex items-center gap-2 mb-2">
                                 <span className="px-2 py-1 bg-gray-100 rounded-lg text-[9px] font-black uppercase text-gray-500 tracking-wider">{i.category}</span>
                                 {i.store && i.store !== 'Divers' && <span className="px-2 py-1 bg-orange-50 rounded-lg text-[9px] font-black uppercase text-orange-600 tracking-wider flex items-center gap-1"><Store size={8}/> {i.store}</span>}
                             </div>
                         )}
                         
                         <p className={`font-bold text-lg leading-snug ${i.type === 'note' ? 'font-handwriting text-yellow-900' : ''}`}>{i.content}</p>
                         
                         <div className={`mt-4 text-[9px] font-black uppercase tracking-widest flex justify-between ${i.type==='msg'?'opacity-60':'text-gray-300'}`}>
                             <span>{i.author}</span>
                             <span>{new Date(i.createdAt).toLocaleDateString()}</span>
                         </div>
                     </div>
                 ))}
                 {items.length === 0 && <div className="col-span-full text-center py-20 text-gray-400 italic">Le tableau est vide. Profitez du calme.</div>}
             </div>
        </div>
    );
};

const WalletView = ({ user }: any) => {
  const [activeTab, setActiveTab] = useState<'family' | 'personal'>('family');
  const [chartRange, setChartRange] = useState<'1M' | '1Y' | '5Y'>('1M');
  const [debts, setDebts] = useState<any[]>([]);
  const [newDebt, setNewDebt] = useState({ from: '', to: '', amount: '', interest: '0' });
  const [myWallet, setMyWallet] = useState<any>(null); 
  const [walletAmount, setWalletAmount] = useState('');
  const [goalInput, setGoalInput] = useState('');

  useEffect(() => {
    if (!user) return;
    const unsubDebts = onSnapshot(query(collection(db, 'family_debts'), orderBy('createdAt', 'desc')), (s) => setDebts(s.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubWallet = onSnapshot(doc(db, 'user_wallets', user.email!), (s) => {
      if (s.exists()) { setMyWallet(s.data()); if(s.data().savingsGoal) setGoalInput(s.data().savingsGoal.toString()); } 
      else { setDoc(doc(db, 'user_wallets', user.email!), { balance: 0, history: [], savingsGoal: 0, startBalance: 0 }); }
    });
    return () => { unsubDebts(); unsubWallet(); };
  }, [user]);

  if (!myWallet && activeTab === 'personal') return <div className="flex justify-center p-10"><Loader2 className="animate-spin text-gray-400"/></div>;

  const addDebt = async () => { if (!newDebt.from || !newDebt.to || !newDebt.amount) return; await addDoc(collection(db, 'family_debts'), { ...newDebt, amount: parseFloat(newDebt.amount), interest: parseFloat(newDebt.interest || '0'), createdAt: new Date().toISOString() }); setNewDebt({ from: '', to: '', amount: '', interest: '0' }); };
  const calculateDebt = (debt: any) => { if (!debt.interest) return debt.amount; const days = Math.floor((new Date().getTime() - new Date(debt.createdAt).getTime()) / (86400000)); return (debt.amount + debt.amount * (debt.interest / 100) * (days / 365)).toFixed(2); };
  const updateBalance = async (type: 'add' | 'sub') => { const val = parseFloat(walletAmount); if (!val) return; const newBal = type === 'add' ? myWallet.balance + val : myWallet.balance - val; await updateDoc(doc(db, 'user_wallets', user.email!), { balance: newBal, history: [...(myWallet.history || []), { date: new Date().toISOString(), amount: type === 'add' ? val : -val, newBalance: newBal }] }); setWalletAmount(''); };
  const saveGoal = async () => { const v = parseFloat(goalInput); if(!isNaN(v)) await updateDoc(doc(db, 'user_wallets', user.email!), { savingsGoal: v, startBalance: myWallet.balance }); };
  
  const getGraphData = () => {
      if (!myWallet?.history) return [];
      const now = new Date(); let cutoff = new Date();
      if(chartRange === '1M') cutoff.setMonth(now.getMonth() - 1);
      if(chartRange === '1Y') cutoff.setFullYear(now.getFullYear() - 1);
      if(chartRange === '5Y') cutoff.setFullYear(now.getFullYear() - 5);
      const filtered = myWallet.history.filter((h:any) => new Date(h.date) >= cutoff);
      filtered.sort((a:any, b:any) => new Date(a.date).getTime() - new Date(b.date).getTime());
      return filtered.map((h: any) => ({ name: new Date(h.date).toLocaleDateString(), solde: h.newBalance }));
  };

  const graphData = getGraphData();
  const currentMonthHistory = (myWallet?.history || []).filter((h: any) => new Date(h.date).getMonth() === new Date().getMonth());
  let fillPercent = 0; if (myWallet && (myWallet.savingsGoal - myWallet.startBalance) > 0) { fillPercent = ((myWallet.balance - myWallet.startBalance) / (myWallet.savingsGoal - myWallet.startBalance)) * 100; } if (myWallet && myWallet.balance >= myWallet.savingsGoal && myWallet.savingsGoal > 0) fillPercent = 100;

  return (
    <div className="space-y-8 pb-20 animate-in fade-in" id="top">
      <div className="flex justify-center gap-4 mb-8">
          <button onClick={() => setActiveTab('family')} className={`px-8 py-4 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${activeTab === 'family' ? 'bg-black text-white shadow-xl scale-105' : 'bg-white text-gray-400 hover:bg-gray-50'}`}><ShieldAlert className="inline mr-2 mb-1" size={16}/> Dettes</button>
          <button onClick={() => setActiveTab('personal')} className={`px-8 py-4 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${activeTab === 'personal' ? 'bg-black text-white shadow-xl scale-105' : 'bg-white text-gray-400 hover:bg-gray-50'}`}><PiggyBank className="inline mr-2 mb-1" size={16}/> Tirelire</button>
      </div>
      
      {activeTab === 'family' ? (
        <div className="bg-white/80 backdrop-blur-xl p-8 rounded-[3rem] shadow-xl border border-white space-y-8" id="wallet-debts">
           <h3 className="text-xl font-cinzel font-bold text-center mb-6">Tableau des Dettes</h3>
           <div className="flex flex-col md:flex-row gap-4 items-end bg-gray-50 p-6 rounded-[2rem]">
                <div className="flex-1 w-full"><label className="text-[10px] font-black uppercase text-gray-400 ml-2">Qui ?</label><input value={newDebt.from} onChange={e => setNewDebt({...newDebt, from: e.target.value})} placeholder="ex: G" className="w-full p-4 rounded-xl border-none font-bold shadow-sm" /></div>
                <div className="flex-1 w-full"><label className="text-[10px] font-black uppercase text-gray-400 ml-2">À qui ?</label><input value={newDebt.to} onChange={e => setNewDebt({...newDebt, to: e.target.value})} placeholder="ex: P" className="w-full p-4 rounded-xl border-none font-bold shadow-sm" /></div>
                <div className="flex-1 w-full"><label className="text-[10px] font-black uppercase text-gray-400 ml-2">Montant</label><input type="number" value={newDebt.amount} onChange={e => setNewDebt({...newDebt, amount: e.target.value})} placeholder="€" className="w-full p-4 rounded-xl border-none font-bold shadow-sm" /></div>
                <button onClick={addDebt} className="p-4 bg-black text-white rounded-xl shadow-lg hover:scale-105 transition-transform"><Plus/></button>
           </div>
           <div className="grid md:grid-cols-2 gap-4">
               {debts.map(d => (
                   <div key={d.id} className="flex justify-between p-6 bg-white rounded-[2rem] border border-gray-100 shadow-sm relative group">
                       <div>
                           <div className="font-cinzel font-bold text-xl">{d.from} <span className="text-gray-300 text-xs">DOIT</span> {d.to}</div>
                           <div className="text-3xl font-black mt-2 text-red-400">{calculateDebt(d)}€</div>
                       </div>
                       <button onClick={() => deleteDoc(doc(db, 'family_debts', d.id))} className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all"><Trash2 size={20}/></button>
                   </div>
               ))}
           </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 bg-white/80 backdrop-blur-xl p-8 rounded-[3rem] shadow-xl border border-white space-y-8 flex flex-col items-center">
                 <div className="relative h-64 w-full"><CircleLiquid fillPercentage={fillPercent} /><div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"><span className="text-[10px] font-black uppercase tracking-widest text-yellow-800/50 mb-1">Solde Actuel</span><h2 className="text-5xl font-black text-yellow-900 drop-shadow-sm">{myWallet?.balance?.toFixed(0)}€</h2></div></div>
                 <div className="flex gap-3 justify-center w-full">
                     <button onClick={() => updateBalance('sub')} className="p-4 bg-white hover:bg-red-50 text-red-500 rounded-2xl shadow-sm hover:shadow-md transition-all"><Minus/></button>
                     <input type="number" value={walletAmount} onChange={e => setWalletAmount(e.target.value)} className="w-32 text-center bg-white rounded-2xl font-black text-xl shadow-inner outline-none" placeholder="0" />
                     <button onClick={() => updateBalance('add')} className="p-4 bg-white hover:bg-green-50 text-green-500 rounded-2xl shadow-sm hover:shadow-md transition-all"><Plus/></button>
                 </div>
                 <div className="w-full bg-white p-4 rounded-2xl shadow-sm flex items-center gap-3">
                     <Target size={20} className="text-yellow-600"/>
                     <div className="flex-1">
                         <label className="text-[9px] font-black uppercase text-gray-400">Objectif</label>
                         <input type="number" value={goalInput} onChange={e => setGoalInput(e.target.value)} onBlur={saveGoal} placeholder="Définir..." className="w-full bg-transparent font-bold outline-none"/>
                     </div>
                 </div>
            </div>
            
            <div className="lg:col-span-2 space-y-6">
                <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-gray-100 h-80 relative flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-cinzel font-bold text-lg">Évolution</h3>
                        <div className="flex bg-gray-50 p-1 rounded-xl">
                            {['1M', '1Y', '5Y'].map(r => (
                                <button key={r} onClick={() => setChartRange(r as any)} className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${chartRange === r ? 'bg-white shadow text-black' : 'text-gray-400'}`}>{r}</button>
                            ))}
                        </div>
                    </div>
                    <div className="flex-1 w-full"><SimpleLineChart data={graphData} color="#a85c48" /></div>
                </div>
                
                <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-gray-100">
                    <h3 className="font-cinzel font-bold text-lg mb-6 flex items-center gap-2"><History size={20}/> Historique</h3>
                    <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
                        {currentMonthHistory.length === 0 && <div className="text-center italic text-gray-400 py-4">Rien ce mois-ci.</div>}
                        {currentMonthHistory.slice().reverse().map((h: any, i: number) => (
                            <div key={i} className="flex justify-between items-center p-4 bg-gray-50 rounded-2xl">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full ${h.amount > 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>{h.amount > 0 ? <TrendingUp size={16}/> : <TrendingDown size={16}/>}</div>
                                    <span className="text-xs font-bold text-gray-400 uppercase">{new Date(h.date).toLocaleDateString()}</span>
                                </div>
                                <span className={`font-black ${h.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>{h.amount > 0 ? '+' : ''}{h.amount}€</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

// --- AUTRES VUES ---
const TasksView = ({ choreStatus, toggleChore, myLetter }: any) => (
    <div className="max-w-5xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-8 pb-32" id="tasks-table">
        <div className="text-center space-y-4">
            <h2 className="text-5xl font-cinzel font-black text-gray-800">CORVÉES</h2>
            <p className="text-gray-500 font-serif italic max-w-md mx-auto">
                "Une maison propre est le signe d'une famille heureuse (ou qui a trop de temps libre)."
                <br/>
                <span className="font-bold mt-2 block text-sm bg-black/5 rounded-full py-1 px-3 w-fit mx-auto">{myLetter ? `Ton code : ${myLetter}` : "Connecte-toi"}</span>
            </p>
        </div>
        <div className="bg-white/80 backdrop-blur-xl rounded-[3rem] shadow-2xl overflow-hidden border border-white/50">
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="text-left bg-gray-50/80">
                            <th className="p-6 font-black uppercase text-xs tracking-widest text-gray-400 w-32">Weekend</th>
                            <th className="p-6 font-black uppercase text-xs tracking-widest text-center text-gray-800">Aspirateur Haut</th>
                            <th className="p-6 font-black uppercase text-xs tracking-widest text-center text-gray-800">Aspirateur Bas</th>
                            <th className="p-6 font-black uppercase text-xs tracking-widest text-center text-gray-800">Salles d'eau</th>
                            <th className="p-6 w-16"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {getMonthWeekends().map((week, i) => { 
                            const rowStatus = choreStatus[week.id] || {}; 
                            const isRowComplete = rowStatus.G && rowStatus.P && rowStatus.V; 
                            const now = new Date(); 
                            const isLocked = week.fullDate.getTime() > (now.getTime() + 86400000 * 6); 
                            return (
                                <tr key={i} className={`transition-colors ${isRowComplete ? 'bg-green-50/50' : 'hover:bg-white/60'}`}>
                                    <td className="p-6 font-mono font-bold text-gray-600 whitespace-nowrap text-sm">
                                        {week.dateStr}
                                        {isLocked && <span className="ml-2 text-xs opacity-30">🔒</span>}
                                    </td>
                                    <TaskCell weekId={week.id} letter={week.haut} label="Aspi Haut" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter} />
                                    <TaskCell weekId={week.id} letter={week.bas} label="Aspi Bas" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter} />
                                    <TaskCell weekId={week.id} letter={week.douche} label="Lavabo" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter} />
                                    <td className="p-6 text-center">{isRowComplete && <CheckCircle2 className="text-green-500 mx-auto animate-bounce drop-shadow-md" size={24}/>}</td>
                                </tr>
                            ); 
                        })}
                    </tbody>
                </table>
            </div>
            <div className="p-6 bg-gray-50/50 text-center text-[10px] font-black uppercase tracking-widest text-gray-400 border-t border-gray-100">
                Rotation Automatique • G = Gabriel • P = Pauline • V = Valentin
            </div>
        </div>
    </div>
);

// --- ADMIN PANEL ---
const AdminPanel = ({ config, save, users, notifications, xsitePages }: any) => {
  const [tab, setTab] = useState('users');
  const [notif, setNotif] = useState({ message: '', targets: ['all'], type: 'info' });
  const [newUser, setNewUser] = useState({ email: '', letter: '', name: '' });
  const [localC, setLocalC] = useState(config);
  
  return (
    <div className="bg-white/90 backdrop-blur-xl rounded-[2.5rem] shadow-2xl h-[70vh] border border-black/5 flex flex-col md:flex-row overflow-hidden">
        {/* SIDEBAR ADMIN */}
        <nav className="w-full md:w-64 bg-gray-50 p-6 flex flex-col gap-4 overflow-y-auto shrink-0 border-r border-gray-100">
            <h4 className="text-xs font-black uppercase text-gray-400 tracking-widest mb-2">Menu</h4>
            <button onClick={() => setTab('users')} className={`p-4 rounded-2xl text-xs font-bold text-left transition-all ${tab==='users'?'bg-black text-white shadow-lg':'hover:bg-white text-gray-600'}`}>Utilisateurs</button>
            <button onClick={() => setTab('notif')} className={`p-4 rounded-2xl text-xs font-bold text-left transition-all ${tab==='notif'?'bg-black text-white shadow-lg':'hover:bg-white text-gray-600'}`}>Notifications</button>
            <button onClick={() => setTab('home')} className={`p-4 rounded-2xl text-xs font-bold text-left transition-all ${tab==='home'?'bg-black text-white shadow-lg':'hover:bg-white text-gray-600'}`}>Accueil</button>
            <button onClick={() => window.location.reload()} className="mt-auto text-red-400 text-xs font-bold flex gap-2 items-center p-2 hover:bg-red-50 rounded-xl transition-colors"><LogOut size={14}/> Quitter</button>
        </nav>
        
        {/* CONTENU */}
        <main className="flex-1 p-8 overflow-y-auto bg-white/50">
            {tab === 'users' && (
                <div className="space-y-6">
                    <h3 className="text-3xl font-cinzel font-bold text-gray-800">Utilisateurs</h3>
                    <div className="grid gap-3">
                        {users.map((u:any) => (
                            <div key={u.id} className="p-4 bg-white border border-gray-100 rounded-2xl flex justify-between items-center shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-black text-gray-500">{u.letter}</div>
                                    <div><div className="font-bold text-sm">{u.name || 'Sans nom'}</div><div className="text-xs text-gray-400">{u.email}</div></div>
                                </div>
                                <span className="text-[10px] font-bold bg-green-50 text-green-600 px-3 py-1 rounded-full">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : '-'}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {tab === 'notif' && (
                <div className="space-y-6">
                    <h3 className="text-3xl font-cinzel font-bold text-gray-800">Envoyer Notification</h3>
                    <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
                        <textarea value={notif.message} onChange={e => setNotif({...notif, message: e.target.value})} className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-medium h-32 resize-none" placeholder="Message..." />
                        <div className="flex justify-end mt-4">
                            <button onClick={async () => { if(notif.message) { await addDoc(collection(db, 'notifications'), { ...notif, createdAt: new Date().toISOString(), readBy: {} }); alert('Envoyé'); setNotif({...notif, message: ''}); }}} className="px-8 py-3 bg-black text-white rounded-xl font-bold shadow-lg hover:scale-105 transition-transform">Envoyer</button>
                        </div>
                    </div>
                </div>
            )}
            {tab === 'home' && (
                <div className="space-y-6">
                    <h3 className="text-3xl font-cinzel font-bold text-gray-800">Modifier l'Accueil</h3>
                    <div className="space-y-4 max-w-xl">
                        <input value={localC.welcomeTitle} onChange={e => setLocalC({...localC, welcomeTitle: e.target.value})} className="w-full p-5 border-none shadow-sm bg-white rounded-2xl font-bold text-lg" placeholder="Titre" />
                        <textarea value={localC.welcomeText} onChange={e => setLocalC({...localC, welcomeText: e.target.value})} className="w-full p-5 border-none shadow-sm bg-white rounded-2xl h-32 resize-none" placeholder="Texte" />
                        <button onClick={() => save(localC, true)} className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-xl hover:scale-[1.02] transition-transform">Sauvegarder les changements</button>
                    </div>
                </div>
            )}
        </main>
    </div>
  );
};

// ============================================================================
// 6. APPLICATION PRINCIPALE (ROUTING & STATE)
// ============================================================================

const App = () => {
  const [user, setUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState('home');
  const [config, setConfig] = useState(ORIGINAL_CONFIG);
  const [data, setData] = useState<any>({ users: [], notifications: [], xsitePages: [] });
  const [usersMapping, setUsersMapping] = useState({});
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [currentRecipe, setCurrentRecipe] = useState<any>({ id: '', title: '', chef: '', ingredients: '', steps: '', category: 'plat', image: '' });
  const [aiLink, setAiLink] = useState('');
  const [newEvent, setNewEvent] = useState({ title: '', date: new Date().toISOString().split('T')[0], time: '', isAllDay: true });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [choreStatus, setChoreStatus] = useState<Record<string, any>>({});
  const [selectedXSite, setSelectedXSite] = useState<any>(null);
  const [xsitePages, setXsitePages] = useState<any[]>([]); 
  const [favorites, setFavorites] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [versions, setVersions] = useState<SiteVersion[]>([]);

  // INITIALISATION
  useEffect(() => {
    onAuthStateChanged(auth, async (u) => { setUser(u); if(u?.email) setDoc(doc(db, 'site_users', u.email), { email: u.email, lastLogin: new Date().toISOString() }, { merge: true }); });
    
    // LISTENERS FIRESTORE (TEMPS RÉEL)
    const unsubC = onSnapshot(doc(db, 'site_config', 'main'), (d) => d.exists() && setConfig(d.data() as SiteConfig));
    const unsubU = onSnapshot(collection(db, 'site_users'), (s) => { 
        const u = s.docs.map(d => ({id:d.id, ...d.data()})); 
        setData((p:any) => ({...p, users: u}));
        const m:any = {}; u.forEach((ux:any) => { if(usersMapping) m[ux.id] = ux.letter || ux.name?.[0] }); setUsersMapping(m);
    });
    const unsubR = onSnapshot(collection(db, 'family_recipes'), (s) => setRecipes(s.docs.map(d => ({ ...d.data(), id: d.id } as Recipe))));
    const unsubE = onSnapshot(collection(db, 'family_events'), (s) => { const rawEvents = s.docs.map(d => ({ ...d.data(), id: d.id } as FamilyEvent)); rawEvents.sort((a, b) => a.date.localeCompare(b.date)); setEvents(rawEvents); });
    const unsubT = onSnapshot(collection(db, 'chores_status'), (s) => { const status: Record<string, any> = {}; s.docs.forEach(doc => { status[doc.id] = doc.data(); }); setChoreStatus(status); });
    const unsubX = onSnapshot(query(collection(db, 'xsite_pages'), orderBy('timestamp', 'desc')), (s) => setXsitePages(s.docs.map(d => ({ ...d.data(), id: d.id }))));
    const unsubN = onSnapshot(query(collection(db, 'notifications'), orderBy('createdAt', 'desc')), (s) => setNotifications(s.docs.map(d => ({id: d.id, ...d.data()} as AppNotification))));

    return () => { unsubC(); unsubU(); unsubR(); unsubE(); unsubT(); unsubX(); unsubN(); };
  }, []);

  // CRUD HELPERS
  const addEntry = async (col: string, val: any) => addDoc(collection(db, col), val);
  const updateEntry = async (col: string, id: string, data: any) => setDoc(doc(db, col, id), { ...data, timestamp: serverTimestamp() }, { merge: true });
  const deleteItem = async (col: string, id: string) => deleteDoc(doc(db, col, id));
  
  // LOGIQUE SPÉCIFIQUE
  const openEditRecipe = (recipe: any) => { const ingredientsStr = Array.isArray(recipe.ingredients) ? recipe.ingredients.join('\n') : recipe.ingredients; const stepsStr = recipe.steps || recipe.instructions || ''; setCurrentRecipe({ ...recipe, ingredients: ingredientsStr, steps: stepsStr }); setIsRecipeModalOpen(true); };
  const handleAiRecipe = async () => { if (!aiLink.trim()) return; setIsAiLoading(true); const res = await extractRecipeFromUrl(aiLink); if (res) setCurrentRecipe({ ...currentRecipe, ...res }); setAiLink(''); setIsAiLoading(false); };
  const addRecipeToHub = async (r:any) => {
      if(window.confirm(`Ajouter les ingrédients de ${r.title} ?`)) {
          const ings = Array.isArray(r.ingredients) ? r.ingredients : (typeof r.ingredients === 'string' ? r.ingredients.split('\n') : []);
          for(const ing of ings) { if(ing.trim()) await addEntry('hub_items', { type: 'shop', content: ing.trim(), category: categorizeShoppingItem(ing), author: 'Chef', createdAt: new Date().toISOString(), done: false }); }
      }
  }; 
  const toggleChore = async (weekId: string, letter: string) => { try { const currentStatus = choreStatus[weekId]?.[letter] || false; await setDoc(doc(db, 'chores_status', weekId), { [letter]: !currentStatus }, { merge: true }); } catch (e) { console.error("Erreur coche", e); } };
  const saveConfig = async (c: SiteConfig, saveHistory = false) => { try { await setDoc(doc(db, 'site_config', 'main'), c); setConfig(c); if(saveHistory) await addDoc(collection(db, 'site_versions'), { name: `Sauvegarde`, date: new Date().toISOString(), config: c }); } catch(e) { console.error(e); } };

  if (!user) return <div className="h-screen flex flex-col items-center justify-center bg-[#f5ede7] p-6 animate-in fade-in"><Background color="#a85c48"/><div className="text-center z-10 space-y-6"><div className="w-24 h-24 bg-[#a85c48] rounded-[2rem] mx-auto flex items-center justify-center shadow-2xl rotate-3 hover:rotate-0 transition-transform duration-500"><ChefHat size={48} className="text-white"/></div><h1 className="text-5xl font-cinzel font-black text-[#a85c48] tracking-widest drop-shadow-sm">CHAUD DEVANT</h1><p className="text-gray-500 font-serif italic text-lg">Connectez-vous pour entrer dans la cuisine.</p><button onClick={() => signInWithPopup(auth, googleProvider)} className="bg-white px-10 py-5 rounded-2xl shadow-xl font-black flex items-center gap-4 text-sm uppercase tracking-[0.2em] hover:scale-105 transition-transform hover:shadow-2xl border border-white/50"><LogIn size={20}/> Connexion Google</button></div></div>;

  const myLetter = user && user.email ? (usersMapping[user.email] || user.email.charAt(0).toUpperCase()) : null;

  return (
    <div className="min-h-screen pb-24 md:pb-0 font-sans selection:bg-orange-200 selection:text-orange-900 transition-colors duration-700" style={{ backgroundColor: config.backgroundColor }}>
        <Background color={config.primaryColor} />
        
        {/* --- HEADER --- */}
        <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-xl border-b border-black/5 z-50 h-24 px-6 flex items-center justify-between transition-all">
            <div onClick={() => setCurrentView('home')} className="flex items-center gap-4 cursor-pointer group">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg bg-[#a85c48] text-white transform group-hover:rotate-12 transition-transform duration-500"><Home className="text-white" size={24} /></div>
                <span className="font-cinzel font-black text-xl hidden md:block tracking-widest" style={{ color: config.primaryColor }}>CHAUD.DEVANT</span>
            </div>
            <div className="flex gap-4">
                {user.email === ADMIN_EMAIL && <button onClick={() => setCurrentView('edit')} className="p-3 hover:bg-gray-100 rounded-xl transition-colors text-gray-500 hover:text-black"><Settings size={20}/></button>}
                <button onClick={() => setIsMenuOpen(true)} className="md:hidden p-3 bg-white rounded-xl shadow-sm text-black"><Menu/></button>
            </div>
        </nav>

        {/* --- NAVIGATION --- */}
        <SideMenu config={config} isOpen={isMenuOpen} close={() => setIsMenuOpen(false)} setView={setCurrentView} logout={() => signOut(auth)} />
        <BottomNav config={config} view={currentView} setView={setCurrentView} />

        {/* --- CONTENU PRINCIPAL --- */}
        <main className="max-w-7xl mx-auto px-6 pt-32 pb-32 relative z-10">
            
            {currentView === 'home' && (
                <div className="space-y-12 animate-in fade-in duration-700">
                    <section className="relative h-[60vh] rounded-[3.5rem] overflow-hidden shadow-2xl group cursor-pointer border-4 border-white" onClick={() => setCurrentView('hub')}>
                        <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors duration-700 z-10"/>
                        <img src={config.welcomeImage} className="w-full h-full object-cover transition-transform duration-[20s] group-hover:scale-110" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-10 md:p-16 z-20">
                            <h1 className="text-5xl md:text-7xl font-cinzel font-black text-white leading-none mb-4 drop-shadow-lg">{config.welcomeTitle}</h1>
                            <p className="text-lg md:text-xl text-white/90 font-medium italic max-w-lg mb-8">{config.welcomeText}</p>
                            <button className="bg-white text-black px-8 py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl flex items-center gap-3 w-fit hover:scale-105 transition-transform group-hover:shadow-2xl">
                                <LayoutDashboard size={20}/> Ouvrir le Tableau
                            </button>
                        </div>
                    </section>
                    
                    {config.homeHtml && (
                        <section id="home-widget" className="bg-white/80 backdrop-blur-md rounded-[3rem] overflow-hidden shadow-xl mb-8 border border-white/50">
                            <iframe srcDoc={config.homeHtml} className="w-full h-[500px] border-none" sandbox="allow-scripts" title="Home Widget" />
                        </section>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <HomeCard icon={<CalIcon size={40}/>} title="Semainier" label="Menus" onClick={() => setCurrentView('cooking')} color={config.primaryColor} />
                        <HomeCard icon={<UtensilsCrossed size={40}/>} title="Frigo" label="Scanner IA" onClick={() => setCurrentView('fridge')} color={config.primaryColor} />
                        <HomeCard icon={<ChefHat size={40}/>} title="Recettes" label="Cuisine" onClick={() => setCurrentView('recipes')} color={config.primaryColor} />
                        <HomeCard icon={<Wallet size={40}/>} title="Comptes" label="Budget" onClick={() => setCurrentView('wallet')} color={config.primaryColor} />
                    </div>
                </div>
            )}

            {currentView === 'hub' && (
                <>
                    <HubView user={user} config={config} usersMapping={usersMapping} onAddItem={addEntry} />
                    <ButlerFloating chatHistory={chatHistory} setChatHistory={setChatHistory} isAiLoading={isAiLoading} setIsAiLoading={setIsAiLoading} onAction={(type: string, item: string) => addEntry('hub_items', { type: 'shop', content: item, category: categorizeShoppingItem(item), store: 'Divers', author: 'Majordome', createdAt: new Date().toISOString(), done: false })} />
                </>
            )}

            {currentView === 'fridge' && <FridgeView />}
            
            {currentView === 'wallet' && <WalletView user={user} config={config} />}
            
            {currentView === 'tasks' && <TasksView choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter} />}
            
            {currentView === 'recipes' && (
                <RecipesView 
                    recipes={recipes} 
                    addRecipeToHub={addRecipeToHub} 
                    openEditRecipe={openEditRecipe} 
                    deleteItem={deleteItem} 
                    setIsRecipeModalOpen={setIsRecipeModalOpen} 
                    isRecipeModalOpen={isRecipeModalOpen} 
                    currentRecipe={currentRecipe} 
                    setCurrentRecipe={setCurrentRecipe} 
                    updateEntry={updateEntry} 
                    addEntry={addEntry} 
                    handleAiRecipe={handleAiRecipe} 
                    aiLink={aiLink} 
                    setAiLink={setAiLink} 
                    isAiLoading={isAiLoading}
                />
            )}

            {currentView === 'calendar' && (
                <div className="max-w-3xl mx-auto space-y-10 animate-in fade-in" id="calendar-view">
                    <div className="flex flex-col items-center gap-6">
                        <h2 className="text-5xl font-cinzel font-black" style={{ color: config.primaryColor }}>CALENDRIER</h2>
                        <button onClick={() => setIsEventModalOpen(true)} className="bg-black text-white px-8 py-4 rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform flex items-center gap-3 shadow-xl">
                            <Plus size={20}/> Ajouter un événement
                        </button>
                    </div>
                    <EventModal isOpen={isEventModalOpen} onClose={setIsEventModalOpen} config={config} addEntry={addEntry} newEvent={newEvent} setNewEvent={setNewEvent} />
                    <div className="space-y-4">
                        {events.length === 0 && <div className="text-center py-20 text-gray-400 italic">Aucun événement à venir.</div>}
                        {events.map(ev => { 
                            const cleanDate = ev.date.split('T')[0]; 
                            const dateObj = new Date(cleanDate); 
                            return (
                                <div key={ev.id} className="flex items-center gap-6 p-6 bg-white rounded-3xl shadow-sm border border-black/5 hover:shadow-md transition-all group hover:-translate-y-1">
                                    <div className="text-center w-16 bg-gray-50 rounded-2xl p-2">
                                        <div className="font-black text-2xl leading-none" style={{color: config.primaryColor}}>{dateObj.getDate()}</div>
                                        <div className="text-[9px] uppercase font-bold text-gray-400 tracking-wider">{dateObj.toLocaleString('fr-FR', { month: 'short' })}</div>
                                    </div>
                                    <div className="flex-1">
                                        <div className="font-bold text-lg font-cinzel text-gray-800">{ev.title}</div>
                                        {ev.time && <div className="text-xs text-gray-400 flex items-center mt-1 font-bold uppercase tracking-wider"><Clock size={12} className="mr-1"/> {ev.time}</div>}
                                    </div>
                                    <button onClick={() => deleteItem('family_events', ev.id)} className="opacity-0 group-hover:opacity-100 p-3 bg-red-50 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all"><Trash2 size={16} /></button>
                                </div>
                            ); 
                        })}
                    </div>
                </div>
            )}

            {currentView === 'xsite' && (
              <div className="space-y-10 animate-in fade-in">
                 {!selectedXSite ? (
                    (user.email === ADMIN_EMAIL || favorites.length > 0) ? (
                        <>
                            <div className="flex flex-col items-center gap-6">
                                <h2 className="text-5xl font-cinzel font-black text-center" style={{ color: config.primaryColor }}>MES FAVORIS</h2>
                                <p className="text-gray-400 italic">Vos accès rapides XSite</p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                                {xsitePages.filter(p => user.email === ADMIN_EMAIL ? true : favorites.includes(p.id)).map(site => (
                                    <div key={site.id} onClick={() => setSelectedXSite(site)} className="bg-white p-8 rounded-[2.5rem] shadow-lg border border-gray-100 cursor-pointer hover:scale-105 transition-transform group">
                                        <div className="flex items-center justify-between mb-6">
                                            <div className="p-4 bg-gray-50 rounded-2xl group-hover:bg-black group-hover:text-white transition-colors"><Map size={24}/></div>
                                            <ArrowLeft size={24} className="rotate-180 opacity-0 group-hover:opacity-50 transition-opacity"/>
                                        </div>
                                        <h3 className="text-xl font-bold uppercase tracking-wide mb-2">{site.name}</h3>
                                        <div className="text-xs text-gray-400 font-bold uppercase tracking-widest">Ouvrir le site</div>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-20 space-y-6 text-center">
                            <div className="p-8 bg-white rounded-[3rem] shadow-xl animate-pulse">
                                <QrCode size={64} className="text-gray-300"/>
                            </div>
                            <h2 className="text-3xl font-cinzel font-bold text-gray-400">ACCÈS VERROUILLÉ</h2>
                            <p className="text-gray-400 max-w-md">Veuillez scanner un QR code pour accéder à un mini-site.</p>
                        </div>
                    )
                 ) : null}
              </div>
            )}

            {currentView === 'edit' && (
                user.email === ADMIN_EMAIL ? (
                    <AdminPanel config={config} save={saveConfig} users={data.users} notifications={notifications} xsitePages={xsitePages} />
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 space-y-6 text-center animate-in zoom-in">
                        <div className="p-8 bg-red-50 rounded-full mb-4"><ShieldAlert className="text-red-500 w-16 h-16"/></div>
                        <h2 className="text-4xl font-cinzel font-black text-gray-800">ZONE INTERDITE</h2>
                        <p className="text-gray-500">Seul l'administrateur suprême peut entrer ici.</p>
                    </div>
                )
            )}
        </main>
    </div>
  );
};

export default App;
