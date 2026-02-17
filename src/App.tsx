import React, { useState, useEffect, useRef } from 'react';
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, updateDoc, 
  where, getDoc, arrayUnion, arrayRemove 
} from 'firebase/firestore';
import { 
  Lock, Menu, X, Home, BookHeart, ChefHat, Wallet, PiggyBank,
  Calendar as CalIcon, Settings, Code, Sparkles, Send, History,
  MessageSquare, ChevronRight, LogIn, Loader2, ShieldAlert, RotateCcw, ArrowLeft, Trash2, Pencil, ClipboardList,
  CheckSquare, Square, CheckCircle2, Plus, Minus, Clock, Save, ToggleLeft, ToggleRight, Upload, Image as ImageIcon, Book, Download, TrendingUp, TrendingDown, Percent, Target,
  Map, MonitorPlay, Eye, QrCode, Star, Maximize2, Minimize2, ExternalLink, Link, Copy, LayoutDashboard, ShoppingCart, StickyNote, Users, ShoppingBag, Bell, Mail, CornerDownRight, Store, CalendarClock, ScanBarcode, Camera, Zap, UtensilsCrossed, Search, Grid, List, LogOut
} from 'lucide-react';
import { Recipe, FamilyEvent, ViewType, SiteConfig, SiteVersion } from './types';
import { askAIArchitect, askAIChat, extractRecipeFromUrl, scanProductImage, askButlerAgent, readBarcodeFromImage } from './services/geminiService';
import Background from './components/Background';
import RecipeCard from './components/RecipeCard';

// ============================================================================
// 1. CONSTANTES & CONFIGURATION (TOUJOURS EN PREMIER)
// ============================================================================

const ADMIN_EMAIL = "gabriel.frezouls@gmail.com";

// ✅ DÉFINITION DE NAV_ITEMS EN PREMIER POUR ÉVITER "REFERENCE ERROR"
const NAV_ITEMS = {
    home: "ACCUEIL",
    hub: "HUB",
    fridge: "FRIGO",
    cooking: "SEMAINIER",
    recipes: "RECETTES",
    calendar: "CALENDRIER",
    tasks: "TÂCHES",
    wallet: "TIRELIRE",
    xsite: "XSITE"
};

const COMMON_STORES = [
    "Auchan", "Lidl", "Carrefour", "Leclerc", "Grand Frais", "Intermarché", "Super U", "Monoprix",
    "Marché", "Drive", "Biocoop", "Picard", "Thiriet",
    "Action", "Gifi", "La Foir'Fouille", "Hema",
    "Pharmacie", "Boulangerie", "Boucherie", "Tabac/Presse",
    "Amazon", "Cdiscount", "Relais Colis",
    "Leroy Merlin", "Castorama", "Brico Dépôt", "IKEA", "Jardinerie", "Truffaut",
    "Cultura", "Fnac", "Boulanger", "Darty",
    "Decathlon", "Intersport", "Go Sport",
    "Sephora", "Nocibé", "Marionnaud",
    "Zara", "H&M", "Kiabi", "Vinted"
];

const ORIGINAL_CONFIG: SiteConfig = {
  primaryColor: '#a85c48',
  backgroundColor: '#f5ede7',
  fontFamily: 'Montserrat',
  welcomeTitle: 'CHAUD DEVANT',
  welcomeText: "Bienvenue dans l'espace sacré de notre famille.",
  welcomeImage: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?q=80&w=2070&auto=format&fit=crop',
  navigationLabels: NAV_ITEMS,
  homeHtml: '', 
  cookingHtml: ''
};

// ============================================================================
// 2. TYPES & LOGIQUE MÉTIER
// ============================================================================

interface AppNotification {
    id: string;
    message: string;
    type: 'info' | 'alert' | 'fun';
    repeat: 'once' | 'daily' | 'monthly';
    targets: string[]; 
    scheduledFor?: string; // ISO String
    linkView?: string; 
    linkId?: string;   
    createdAt: string;
    readBy: Record<string, string>; 
}

const VIEW_ANCHORS: Record<string, {label: string, id: string}[]> = {
    home: [
        { label: 'Haut de page', id: 'top' }, 
        { label: 'Widget HTML', id: 'home-widget' }, 
        { label: 'Accès Rapides', id: 'home-shortcuts' }
    ],
    hub: [
        { label: 'Haut de page', id: 'top' }, 
        { label: 'Saisie Rapide', id: 'hub-input' }, 
        { label: 'Liste de Courses', id: 'hub-shop' }, 
        { label: 'Pense-bêtes', id: 'hub-notes' }, 
        { label: 'Le Mur', id: 'hub-msg' }
    ],
    fridge: [
        { label: 'Haut de page', id: 'top' }, 
        { label: 'Scanner', id: 'fridge-scan' }, 
        { label: 'Inventaire', id: 'fridge-list' }
    ],
    recipes: [
        { label: 'Haut de page', id: 'top' }, 
        { label: 'Liste des recettes', id: 'recipes-list' }
    ],
    wallet: [
        { label: 'Haut de page', id: 'top' }, 
        { label: 'Graphique Solde', id: 'wallet-graph' }, 
        { label: 'Dettes Famille', id: 'wallet-debts' }
    ],
    tasks: [
        { label: 'Tableau', id: 'tasks-table' }
    ],
    calendar: [
        { label: 'Calendrier', id: 'calendar-view' }
    ],
    cooking: [
        { label: 'Semainier', id: 'cooking-frame' }
    ]
};

const categorizeShoppingItem = (text: string) => {
    const lower = text.toLowerCase();
    
    if (/(lait|beurre|yaourt|creme|crème|oeuf|fromage|gruyere|mozarella|skyr)/.test(lower)) return 'Frais & Crèmerie';
    if (/(pomme|banane|legume|fruit|salade|tomate|carotte|oignon|ail|patate|courgette|avocat|citron|poireau)/.test(lower)) return 'Primeur';
    if (/(viande|poulet|poisson|jambon|steak|lardon|saucisse|dinde|boeuf|thon|saumon|crevette)/.test(lower)) return 'Boucherie/Poisson';
    if (/(pain|baguette|brioche|croissant|pain de mie|burger)/.test(lower)) return 'Boulangerie';
    if (/(pates|pâte|riz|conserve|huile|vinaigre|moutarde|sel|poivre|epice|sauce|mayo|ketchup|bocal)/.test(lower)) return 'Épicerie Salée';
    if (/(sucre|farine|chocolat|gateau|biscuit|cereale|miel|confiture|nutella|bonbon|chips|apero)/.test(lower)) return 'Épicerie Sucrée';
    if (/(coca|jus|vin|biere|bière|eau|sirop|soda|alcool|cafe|the|tisane|lait)/.test(lower)) return 'Boissons';
    if (/(shampoing|savon|dentifrice|papier|toilette|douche|cosmetique|coton|rasoir|deo)/.test(lower)) return 'Hygiène & Beauté';
    if (/(lessive|produit|eponge|sac|poubelle|nettoyant|vaisselle|javel|sopalin)/.test(lower)) return 'Entretien Maison';
    if (/(ampoule|pile|vis|colle|outil|scotch|peinture)/.test(lower)) return 'Bricolage';
    if (/(fleur|plante|terreau|graine)/.test(lower)) return 'Jardin';
    if (/(croquette|patee|litiere|chat|chien)/.test(lower)) return 'Animaux';
    if (/(glace|surgeles|pizza|frite|poelee)/.test(lower)) return 'Surgelés';
    if (/(couche|bebe|lingette|pot)/.test(lower)) return 'Bébé';
    if (/(medicament|doliprane|pansement|sirop)/.test(lower)) return 'Pharmacie';
    
    return 'Divers';
};

const fetchProductByBarcode = async (barcode: string) => {
    try {
        const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
        const data = await response.json();
        if (data.status === 1) {
            return {
                name: data.product.product_name_fr || data.product.product_name,
                image: data.product.image_front_small_url,
                brand: data.product.brands,
                category: categorizeShoppingItem(data.product.product_name_fr || '')
            };
        }
        return null;
    } catch (e) { 
        console.error("Erreur API:", e); 
        return null; 
    }
};

const ROTATION = ['G', 'P', 'V'];
const REF_DATE = new Date('2025-12-20T12:00:00'); 

const getChores = (date: Date) => {
  const saturday = new Date(date);
  saturday.setDate(date.getDate() - (date.getDay() + 1) % 7);
  saturday.setHours(12, 0, 0, 0);
  const weekId = `${saturday.getDate()}-${saturday.getMonth()+1}-${saturday.getFullYear()}`;
  const diffTime = saturday.getTime() - REF_DATE.getTime();
  const diffWeeks = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 7));
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
  while (date.getDay() !== 6) { date.setDate(date.getDate() + 1); }
  while (date.getMonth() === month) {
    weekends.push(getChores(new Date(date)));
    date.setDate(date.getDate() + 7);
  }
  return weekends;
};

// ============================================================================
// 3. COMPOSANTS DE BASE (UI)
// ============================================================================

const HomeCard = ({ icon, title, label, onClick, color }: any) => (
  <div onClick={onClick} className="bg-white/70 backdrop-blur-md p-8 rounded-[2.5rem] cursor-pointer hover:scale-105 transition-transform shadow-lg border border-white/50 group flex flex-col justify-between h-48">
    <div style={{ color }} className="mb-4 group-hover:scale-110 transition-transform">{icon}</div>
    <div>
        <h3 className="text-xl font-cinzel font-bold mb-1 uppercase">{title}</h3>
        <p className="text-[10px] font-bold tracking-widest opacity-50 uppercase flex items-center gap-1">{label} <ChevronRight size={12}/></p>
    </div>
  </div>
);

const SimpleLineChart = ({ data, color }: { data: any[], color: string }) => {
  if (!data || data.length < 2) return <div className="h-full flex items-center justify-center text-gray-300 italic text-xs">Pas assez de données</div>;
  const width = 300; const height = 100; const padding = 5;
  const values = data.map(d => d.solde);
  const min = Math.min(...values); const max = Math.max(...values);
  const range = max - min || 1; 
  
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
    const y = height - ((d.solde - min) / range) * (height - padding * 2) - padding;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="3" points={points} strokeLinecap="round" strokeLinejoin="round"/>
      {data.map((d, i) => {
        const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
        const y = height - ((d.solde - min) / range) * (height - padding * 2) - padding;
        return (<g key={i}><circle cx={x} cy={y} r="3" fill="white" stroke={color} strokeWidth="2" /></g>);
      })}
    </svg>
  );
};

const CircleLiquid = ({ fillPercentage }: { fillPercentage: number }) => {
  const safePercent = isNaN(fillPercentage) ? 0 : Math.min(Math.max(fillPercentage, 0), 100);
  const size = 200; const radius = 90; const center = size / 2;
  const liquidHeight = (safePercent / 100) * size;
  const liquidY = size - liquidHeight;
  return (
    <div className="relative w-full h-full flex justify-center items-center">
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full drop-shadow-xl overflow-visible">
            <defs><clipPath id="circleClip"><circle cx={center} cy={center} r={radius} /></clipPath><linearGradient id="liquidGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#facc15" /><stop offset="100%" stopColor="#ca8a04" /></linearGradient></defs>
            <circle cx={center} cy={center} r={radius} fill="#fef9c3" stroke="none" /> 
            <rect x="0" y={liquidY} width={size} height={liquidHeight} fill="url(#liquidGrad)" clipPath="url(#circleClip)" className="transition-all duration-1000 ease-in-out" />
            <circle cx={center} cy={center} r={radius} fill="none" stroke="#eab308" strokeWidth="6" />
        </svg>
    </div>
  );
};

const TaskCell = ({ weekId, letter, label, isLocked, choreStatus, toggleChore, myLetter }: any) => {
  const isDone = choreStatus[weekId]?.[letter] || false; 
  const canCheck = !isLocked && myLetter === letter; 
  return (
    <td className="p-4 text-center align-middle">
      <div className="flex flex-col items-center gap-2">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-sm ${isDone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}> {letter} </span>
        <button onClick={() => canCheck && toggleChore(weekId, letter)} disabled={!canCheck} className={`transition-transform active:scale-95 ${!canCheck && !isDone ? 'opacity-20 cursor-not-allowed' : ''}`} title={isLocked ? "Trop tôt pour cocher !" : ""}>
          {isDone ? <CheckSquare className="text-green-500" size={24} /> : (canCheck ? <Square className="text-green-500 hover:fill-green-50" size={24} /> : <Square className="text-gray-200" size={24} />)}
        </button>
      </div>
    </td>
  );
};

// MAJORDOME FLOTTANT & ACTIF
const ButlerFloating = ({ chatHistory, setChatHistory, isAiLoading, setIsAiLoading, contextData, onAction }: any) => {
    const [isOpen, setIsOpen] = useState(false);
    const [msg, setMsg] = useState('');
    
    const handleChat = async () => {
        if (!msg.trim()) return;
        const h = [...chatHistory, { role: 'user', text: msg }];
        setChatHistory(h); setMsg(''); setIsAiLoading(true);
        
        // Appel Agent Majordome (Capable d'actions)
        const response = await askButlerAgent(h, contextData);
        
        if (response.type === 'action') {
            // Exécution de l'action demandée par l'IA
            const actionData = response.data;
            if (actionData.action === 'ADD_HUB') {
                onAction('ADD_HUB', actionData.item);
            }
            setChatHistory([...h, { role: 'model', text: actionData.reply || "C'est fait !" }]);
        } else {
            setChatHistory([...h, { role: 'model', text: response.data || "Je n'ai pas compris." }]);
        }
        setIsAiLoading(false);
    };

    return (
        <div className="fixed bottom-24 right-6 z-[200] flex flex-col items-end">
            {isOpen && (
                <div className="w-80 h-96 bg-white rounded-3xl shadow-2xl border border-gray-100 flex flex-col mb-4 animate-in slide-in-from-bottom-5">
                    <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-3xl">
                        <span className="font-cinzel font-bold text-xs">Le Majordome</span>
                        <button onClick={() => setIsOpen(false)}><X size={16}/></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {chatHistory.map((c:any, i:number) => (
                            <div key={i} className={`p-3 rounded-2xl text-xs ${c.role === 'user' ? 'bg-orange-100 ml-8' : 'bg-gray-100 mr-8'}`}>{c.text}</div>
                        ))}
                        {isAiLoading && <Loader2 className="animate-spin text-gray-300 mx-auto"/>}
                    </div>
                    <div className="p-3 border-t flex gap-2">
                        <input value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChat()} placeholder="Ajouter du lait, une idée repas..." className="flex-1 text-xs p-2 rounded-xl bg-gray-50 outline-none" />
                        <button onClick={handleChat} className="p-2 bg-black text-white rounded-xl"><Send size={14}/></button>
                    </div>
                </div>
            )}
            <button onClick={() => setIsOpen(!isOpen)} className="w-14 h-14 bg-black text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-110 transition-transform">
                {isOpen ? <X/> : <Sparkles size={24} className="animate-pulse text-orange-400"/>}
            </button>
        </div>
    );
};

// ============================================================================
// 4. VUES PRINCIPALES
// ============================================================================

const HubView = ({ user, config, usersMapping, onAddItem }: any) => {
    const [hubItems, setHubItems] = useState<any[]>([]);
    const [newItem, setNewItem] = useState('');
    const [storeSearch, setStoreSearch] = useState('');
    const [selectedStore, setSelectedStore] = useState('');
    const [inputType, setInputType] = useState<'shop' | 'note' | 'msg'>('shop');
    const [showStoreList, setShowStoreList] = useState(false);

    useEffect(() => {
        const q = query(collection(db, 'hub_items'), orderBy('createdAt', 'desc'));
        const unsub = onSnapshot(q, (s) => setHubItems(s.docs.map(d => ({ id: d.id, ...d.data() }))));
        return () => unsub();
    }, []);

    const addItem = async () => {
        if (!newItem.trim()) return;
        let category = 'Général';
        if (inputType === 'shop') category = categorizeShoppingItem(newItem);
        await addDoc(collection(db, 'hub_items'), {
            type: inputType, content: newItem, category,
            store: inputType === 'shop' ? (selectedStore || 'Divers') : null,
            author: usersMapping[user.email!] || user.email?.charAt(0).toUpperCase(),
            createdAt: new Date().toISOString(), done: false
        });
        setNewItem(''); setStoreSearch(''); setSelectedStore('');
    };

    const deleteItem = async (id: string) => { await deleteDoc(doc(db, 'hub_items', id)); };

    const sortedShopItems = hubItems.filter(i => i.type === 'shop').sort((a, b) => {
        const storeA = a.store || 'Z'; 
        const storeB = b.store || 'Z';
        if (storeA !== storeB) return storeA.localeCompare(storeB);
        return a.category.localeCompare(b.category);
    });

    const filteredStores = COMMON_STORES.filter(s => s.toLowerCase().includes(storeSearch.toLowerCase()));

    return (
        <div className="space-y-8 pb-24 animate-in fade-in" id="top">
            <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-gray-100 sticky top-24 z-30" id="hub-input">
                <div className="flex gap-2 mb-4 justify-center">
                    <button onClick={() => setInputType('shop')} className={`flex-1 py-3 rounded-xl font-bold text-xs uppercase transition-all ${inputType === 'shop' ? 'bg-orange-500 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-400'}`}><ShoppingCart size={16} className="inline mr-2"/> Course</button>
                    <button onClick={() => setInputType('note')} className={`flex-1 py-3 rounded-xl font-bold text-xs uppercase transition-all ${inputType === 'note' ? 'bg-yellow-400 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-400'}`}><StickyNote size={16} className="inline mr-2"/> Note</button>
                    <button onClick={() => setInputType('msg')} className={`flex-1 py-3 rounded-xl font-bold text-xs uppercase transition-all ${inputType === 'msg' ? 'bg-blue-500 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-400'}`}><MessageSquare size={16} className="inline mr-2"/> Msg</button>
                </div>
                
                <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                        <input 
                            value={newItem} 
                            onChange={e => setNewItem(e.target.value)} 
                            onKeyDown={e => e.key === 'Enter' && addItem()} 
                            placeholder={inputType === 'shop' ? "Ex: Lait, Beurre..." : "Message..."} 
                            className="flex-1 p-4 rounded-2xl bg-gray-50 font-bold outline-none border-2 border-transparent focus:border-black transition-colors"
                        />
                        <button onClick={addItem} className="p-4 bg-black text-white rounded-2xl hover:scale-105 transition-transform"><Plus/></button>
                    </div>

                    {inputType === 'shop' && (
                        <div className="relative">
                            <div className="flex items-center bg-gray-50 rounded-xl px-4 border border-gray-200">
                                <Store size={16} className="text-gray-400 mr-2"/>
                                <input 
                                    value={storeSearch} 
                                    onFocus={() => setShowStoreList(true)}
                                    onChange={e => { setStoreSearch(e.target.value); setSelectedStore(e.target.value); }} 
                                    placeholder="Rechercher un magasin ou commerce..." 
                                    className="w-full py-3 bg-transparent text-xs font-bold outline-none text-gray-600"
                                />
                            </div>
                            {showStoreList && storeSearch && (
                                <div className="absolute top-full left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto z-50">
                                    {filteredStores.map(store => (
                                        <div key={store} onClick={() => { setSelectedStore(store); setStoreSearch(store); setShowStoreList(false); }} className="p-3 text-xs font-bold hover:bg-gray-50 cursor-pointer border-b border-gray-50">
                                            {store}
                                        </div>
                                    ))}
                                    <div onClick={() => { setSelectedStore(storeSearch); setShowStoreList(false); }} className="p-3 bg-orange-50 text-orange-600 text-xs font-bold hover:bg-orange-100 cursor-pointer flex items-center justify-between">
                                        <span>Ajouter "{storeSearch}"</span>
                                        <Plus size={14}/>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-4" id="hub-shop">
                    <h3 className="font-cinzel font-bold text-xl text-gray-400 flex items-center gap-2"><ShoppingCart size={20}/> LISTE DE COURSES</h3>
                    {sortedShopItems.map(item => (
                        <div key={item.id} className="group flex justify-between items-center p-4 bg-white rounded-2xl shadow-sm border-l-4 border-orange-400 hover:shadow-md transition-all">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    {item.store && <span className="text-[9px] font-bold uppercase text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md"><Store size={8} className="inline mr-1"/>{item.store}</span>}
                                    <span className="text-[9px] font-black uppercase text-orange-600 bg-orange-100 px-2 py-0.5 rounded-md">{item.category}</span>
                                </div>
                                <span className="font-bold text-gray-700 block">{item.content}</span>
                            </div>
                            <button onClick={() => deleteItem(item.id)} className="text-gray-300 hover:text-red-500"><X size={18}/></button>
                        </div>
                    ))}
                    {sortedShopItems.length === 0 && <div className="text-center p-8 border-2 border-dashed border-gray-200 rounded-2xl text-gray-300">Frigo plein !</div>}
                </div>

                <div className="space-y-4" id="hub-notes">
                    <h3 className="font-cinzel font-bold text-xl text-gray-400 flex items-center gap-2"><StickyNote size={20}/> PENSE-BÊTES</h3>
                    <div className="grid grid-cols-2 gap-2">
                        {hubItems.filter(i => i.type === 'note').map(item => (
                            <div key={item.id} className="relative p-4 bg-yellow-50 rounded-xl shadow-sm border border-yellow-100 rotate-1 hover:rotate-0 transition-transform">
                                <button onClick={() => deleteItem(item.id)} className="absolute top-2 right-2 text-yellow-300 hover:text-red-500"><X size={14}/></button>
                                <p className="font-handwriting font-bold text-yellow-900 text-sm">{item.content}</p>
                                <div className="mt-2 text-[10px] text-yellow-600 font-bold uppercase text-right">- {item.author}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-4" id="hub-msg">
                    <h3 className="font-cinzel font-bold text-xl text-gray-400 flex items-center gap-2"><MessageSquare size={20}/> LE MUR</h3>
                    {hubItems.filter(i => i.type === 'msg').map(item => (
                        <div key={item.id} className="p-6 bg-blue-500 text-white rounded-tr-3xl rounded-bl-3xl rounded-tl-xl rounded-br-xl shadow-lg relative group">
                            <button onClick={() => deleteItem(item.id)} className="absolute top-2 right-2 text-blue-300 hover:text-white"><X size={14}/></button>
                            <p className="font-bold text-lg leading-tight">"{item.content}"</p>
                            <p className="mt-4 text-xs opacity-60 uppercase tracking-widest text-right">Posté par {item.author}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const FridgeView = () => {
    const [items, setItems] = useState<any[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [manualEntry, setManualEntry] = useState({ name: '', expiry: '' });
    const fileInputRef = useRef<HTMLInputElement>(null);
    const barcodeInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const unsub = onSnapshot(query(collection(db, 'fridge_items'), orderBy('expiryDate', 'asc')), (s) => setItems(s.docs.map(d => ({id: d.id, ...d.data()}))));
        return () => unsub();
    }, []);

    // 1. SCAN PHOTO PRODUIT
    const handlePhotoScan = async (e: any) => {
        const file = e.target.files[0]; if (!file) return;
        setIsScanning(true);
        const result = await scanProductImage(file); 
        if (result) {
            await addDoc(collection(db, 'fridge_items'), { 
                name: result.name, 
                category: categorizeShoppingItem(result.name), 
                addedAt: new Date().toISOString(), 
                expiryDate: result.expiryDate 
            });
        }
        setIsScanning(false);
    };

    // 2. SCAN CODE BARRE (PHOTO -> IA -> API)
    const handleBarcodePhoto = async (e: any) => {
        const file = e.target.files[0]; if (!file) return;
        setIsScanning(true);
        
        // 1. On demande à Gemini de lire les chiffres sur la photo
        const barcode = await readBarcodeFromImage(file);
        
        if (barcode) {
             // 2. Si on a des chiffres, on appelle OpenFoodFacts
             const product = await fetchProductByBarcode(barcode);
             if (product) {
                 await addDoc(collection(db, 'fridge_items'), { 
                     name: product.name, 
                     category: product.category, 
                     addedAt: new Date().toISOString(), 
                     expiryDate: new Date(Date.now() + 7*86400000).toISOString().split('T')[0] 
                 });
                 alert(`Ajouté : ${product.name}`);
             } else {
                 alert(`Code ${barcode} lu, mais produit inconnu.`);
             }
        } else {
            alert("Code-barres illisible sur la photo. Essayez de bien cadrer.");
        }
        setIsScanning(false);
    };

    return (
        <div className="space-y-8 animate-in fade-in" id="fridge-scan">
            <div className="grid grid-cols-2 gap-4">
                <button onClick={() => barcodeInputRef.current?.click()} className="p-8 bg-white rounded-[2.5rem] shadow-xl border border-gray-100 flex flex-col items-center gap-4 hover:scale-105 transition-transform">
                    {isScanning ? <Loader2 className="animate-spin"/> : <ScanBarcode size={40} className="text-black"/>}
                    <span className="font-bold text-sm uppercase tracking-widest text-center">Scan Code-Barre<br/><span className="text-[10px] text-gray-400">(Photo)</span></span>
                </button>
                <button onClick={() => fileInputRef.current?.click()} className="p-8 bg-white rounded-[2.5rem] shadow-xl border border-gray-100 flex flex-col items-center gap-4 hover:scale-105 transition-transform">
                    {isScanning ? <Loader2 className="animate-spin text-orange-500" size={40}/> : <Camera size={40} className="text-orange-500"/>}
                    <span className="font-bold text-sm uppercase tracking-widest text-center">Scan Produit<br/><span className="text-[10px] text-gray-400">(Photo IA)</span></span>
                </button>
                
                <input type="file" accept="image/*" capture="environment" ref={fileInputRef} className="hidden" onChange={handlePhotoScan} />
                <input type="file" accept="image/*" capture="environment" ref={barcodeInputRef} className="hidden" onChange={handleBarcodePhoto} />
            </div>

            <div className="bg-white p-6 rounded-3xl shadow-sm">
                <h3 className="font-bold text-xs uppercase tracking-widest text-gray-400 mb-4">Ajout Manuel</h3>
                <div className="flex gap-2">
                    <input value={manualEntry.name} onChange={e => setManualEntry({...manualEntry, name: e.target.value})} placeholder="Produit..." className="flex-1 p-3 bg-gray-50 rounded-xl font-bold text-sm outline-none"/>
                    <input type="date" value={manualEntry.expiry} onChange={e => setManualEntry({...manualEntry, expiry: e.target.value})} className="p-3 bg-gray-50 rounded-xl font-bold text-sm outline-none"/>
                    <button onClick={async () => { if(manualEntry.name) { await addDoc(collection(db, 'fridge_items'), { name: manualEntry.name, category: categorizeShoppingItem(manualEntry.name), addedAt: new Date().toISOString(), expiryDate: manualEntry.expiry || new Date().toISOString().split('T')[0] }); setManualEntry({name:'', expiry:''}); }}} className="p-3 bg-black text-white rounded-xl"><Plus/></button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="fridge-list">
                {items.map(item => {
                    const daysLeft = Math.ceil((new Date(item.expiryDate).getTime() - new Date().getTime()) / (1000 * 3600 * 24));
                    return (
                        <div key={item.id} className={`p-5 rounded-3xl shadow-sm flex justify-between items-center group ${daysLeft < 3 ? 'bg-red-50 border border-red-100' : 'bg-white border border-gray-100'}`}>
                            <div>
                                <span className="text-[9px] font-black uppercase text-green-600 bg-green-50 px-2 py-1 rounded-md">{item.category}</span>
                                <h4 className="font-bold text-lg mt-1">{item.name}</h4>
                                <p className={`text-xs font-bold flex items-center gap-1 mt-1 ${daysLeft < 3 ? 'text-red-500' : 'text-green-500'}`}>
                                    <Clock size={12}/> {daysLeft < 0 ? 'PÉRIMÉ' : (daysLeft === 0 ? "AUJOURD'HUI" : `J-${daysLeft}`)}
                                </p>
                            </div>
                            <button onClick={() => deleteDoc(doc(db, 'fridge_items', item.id))} className="text-gray-300 group-hover:text-red-400"><Trash2/></button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const WalletView = ({ user, config }: { user: User, config: SiteConfig }) => {
  const [activeTab, setActiveTab] = useState<'family' | 'personal'>('family');
  const [chartRange, setChartRange] = useState<'1M' | '1Y' | '5Y'>('1M');
  const [debts, setDebts] = useState<any[]>([]);
  const [newDebt, setNewDebt] = useState({ from: '', to: '', amount: '', interest: '', reason: '' });
  const [myWallet, setMyWallet] = useState<any>(null); 
  const [walletAmount, setWalletAmount] = useState('');
  const [newTask, setNewTask] = useState('');
  const [goalInput, setGoalInput] = useState('');

  useEffect(() => {
    if (!user) return;
    const unsubDebts = onSnapshot(query(collection(db, 'family_debts'), orderBy('createdAt', 'desc')), (s) => setDebts(s.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubWallet = onSnapshot(doc(db, 'user_wallets', user.email!), (s) => {
      if (s.exists()) { setMyWallet(s.data()); if(s.data().savingsGoal) setGoalInput(s.data().savingsGoal.toString()); } 
      else { const i = { balance: 0, history: [], tasks: [], savingsGoal: 0, startBalance: 0 }; setDoc(doc(db, 'user_wallets', user.email!), i); setMyWallet(i); }
    });
    return () => { unsubDebts(); unsubWallet(); };
  }, [user]);

  if (!myWallet && activeTab === 'personal') return <div className="flex justify-center p-10"><Loader2 className="animate-spin text-gray-400"/></div>;

  const addDebt = async () => { if (!newDebt.from || !newDebt.to || !newDebt.amount) return alert("Champs vides"); await addDoc(collection(db, 'family_debts'), { ...newDebt, amount: parseFloat(newDebt.amount), interest: parseFloat(newDebt.interest || '0'), createdAt: new Date().toISOString() }); setNewDebt({ from: '', to: '', amount: '', interest: '', reason: '' }); };
  const calculateDebt = (debt: any) => { if (!debt.interest) return debt.amount; const days = Math.floor((new Date().getTime() - new Date(debt.createdAt).getTime()) / (86400000)); return (debt.amount + debt.amount * (debt.interest / 100) * (days / 365)).toFixed(2); };
  const updateBalance = async (type: 'add' | 'sub') => { const val = parseFloat(walletAmount); if (!val) return; const newBal = type === 'add' ? myWallet.balance + val : myWallet.balance - val; await updateDoc(doc(db, 'user_wallets', user.email!), { balance: newBal, history: [...(myWallet.history || []), { date: new Date().toISOString(), amount: type === 'add' ? val : -val, newBalance: newBal, month: new Date().getMonth() }] }); setWalletAmount(''); };
  const saveGoal = async () => { const v = parseFloat(goalInput); if(!isNaN(v)) await updateDoc(doc(db, 'user_wallets', user.email!), { savingsGoal: v, startBalance: myWallet.balance }); };
  const addWalletTask = async () => { if (newTask) { await updateDoc(doc(db, 'user_wallets', user.email!), { tasks: [...(myWallet.tasks || []), { id: Date.now(), text: newTask, done: false }] }); setNewTask(''); }};
  const toggleWalletTask = async (taskId: number) => { await updateDoc(doc(db, 'user_wallets', user.email!), { tasks: myWallet.tasks.map((t: any) => t.id === taskId ? { ...t, done: !t.done } : t) }); };
  const deleteWalletTask = async (taskId: number) => { await updateDoc(doc(db, 'user_wallets', user.email!), { tasks: myWallet.tasks.filter((t: any) => t.id !== taskId) }); };
  
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
    <div className="space-y-6 pb-20 animate-in fade-in" id="top">
      <div className="flex justify-center gap-4 mb-8">
        <button onClick={() => setActiveTab('family')} className={`px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${activeTab === 'family' ? 'bg-black text-white shadow-lg' : 'bg-white text-gray-400'}`}><ShieldAlert className="inline mr-2 mb-1" size={16}/> Dettes Famille</button>
        <button onClick={() => setActiveTab('personal')} className={`px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${activeTab === 'personal' ? 'bg-black text-white shadow-lg' : 'bg-white text-gray-400'}`}><PiggyBank className="inline mr-2 mb-1" size={16}/> Ma Tirelire</button>
      </div>
      {activeTab === 'family' ? (
        <div className="bg-white/80 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-xl border border-white space-y-8" id="wallet-debts">
           <div className="flex flex-col md:flex-row gap-4 items-end bg-gray-50 p-6 rounded-3xl">
             <div className="flex-1 w-full"><label className="text-[10px] font-bold uppercase text-gray-400 ml-2">Qui doit ?</label><input value={newDebt.from} onChange={e => setNewDebt({...newDebt, from: e.target.value})} placeholder="ex: G" className="w-full p-3 rounded-xl border-none font-bold" /></div>
             <div className="flex-1 w-full"><label className="text-[10px] font-bold uppercase text-gray-400 ml-2">À qui ?</label><input value={newDebt.to} onChange={e => setNewDebt({...newDebt, to: e.target.value})} placeholder="ex: P" className="w-full p-3 rounded-xl border-none font-bold" /></div>
             <div className="flex-1 w-full"><label className="text-[10px] font-bold uppercase text-gray-400 ml-2">Montant (€)</label><input type="number" value={newDebt.amount} onChange={e => setNewDebt({...newDebt, amount: e.target.value})} placeholder="0" className="w-full p-3 rounded-xl border-none font-bold" /></div>
             <div className="w-24"><label className="text-[10px] font-bold uppercase text-gray-400 ml-2">Taux (%)</label><input type="number" value={newDebt.interest} onChange={e => setNewDebt({...newDebt, interest: e.target.value})} placeholder="0%" className="w-full p-3 rounded-xl border-none font-bold text-orange-500" /></div>
             <button onClick={addDebt} className="p-4 bg-black text-white rounded-xl shadow-lg hover:scale-105 transition-transform"><Plus/></button>
           </div>
           <div className="grid md:grid-cols-2 gap-4">
             {debts.map(d => (
               <div key={d.id} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 relative group">
                 <button onClick={() => deleteDoc(doc(db, 'family_debts', d.id))} className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 text-red-400"><Trash2 size={16}/></button>
                 <div className="flex justify-between items-center mb-2"><span className="font-cinzel font-bold text-xl">{d.from} <span className="text-gray-300 text-xs mx-1">DOIT À</span> {d.to}</span><span className="text-2xl font-black" style={{color: config.primaryColor}}>{calculateDebt(d)}€</span></div>
                 <div className="flex gap-4 text-[10px] font-bold uppercase text-gray-400"><span>Initial: {d.amount}€</span>{d.interest > 0 && <span className="text-orange-400 flex items-center"><Percent size={10} className="mr-1"/> Intérêt: {d.interest}%</span>}<span>{new Date(d.createdAt).toLocaleDateString()}</span></div>
               </div>
             ))}
           </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
             <div className="relative h-64 w-full"><CircleLiquid fillPercentage={fillPercent} /><div className="absolute inset-0 flex flex-col items-center justify-center"><p className="text-[10px] font-black uppercase text-yellow-800/60 tracking-widest mb-1">Solde Actuel</p><h2 className="text-5xl font-cinzel font-black text-yellow-900 drop-shadow-sm mb-4">{myWallet?.balance?.toFixed(0)}€</h2><div className="flex items-center gap-2 bg-white/40 p-1.5 rounded-2xl backdrop-blur-sm shadow-sm border border-white/50 w-48"><button onClick={() => updateBalance('sub')} className="p-2 bg-white/50 hover:bg-red-400 hover:text-white rounded-xl transition-colors"><Minus size={16}/></button><input type="number" value={walletAmount} onChange={e => setWalletAmount(e.target.value)} className="w-full bg-transparent text-center font-bold text-lg outline-none text-yellow-900 placeholder-yellow-800/40" placeholder="..." /><button onClick={() => updateBalance('add')} className="p-2 bg-white/50 hover:bg-green-400 hover:text-white rounded-xl transition-colors"><Plus size={16}/></button></div></div></div>
             <div className="bg-white p-4 rounded-3xl shadow-sm border border-yellow-100 flex items-center gap-3"><div className="p-3 bg-yellow-100 text-yellow-600 rounded-full"><Target size={20}/></div><div className="flex-1"><label className="text-[10px] font-bold uppercase text-gray-400">Objectif</label><input type="number" value={goalInput} onChange={e => setGoalInput(e.target.value)} onBlur={saveGoal} className="w-full font-black text-gray-700 outline-none" placeholder="Définir..." />{myWallet?.startBalance > 0 && <span className="text-[10px] text-gray-300">Départ: {myWallet.startBalance}€</span>}</div>{fillPercent > 0 && <span className="text-xs font-bold text-yellow-600 bg-yellow-50 px-2 py-1 rounded-lg">{fillPercent.toFixed(0)}%</span>}</div>
             <div className="bg-white p-6 rounded-[2rem] shadow-lg border border-gray-100"><h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2"><ClipboardList size={14}/> Tâches Rémunérées</h3><div className="flex gap-2 mb-4"><input value={newTask} onChange={e => setNewTask(e.target.value)} placeholder="Ajouter une tâche..." className="flex-1 bg-gray-50 rounded-xl px-3 text-sm font-bold outline-none" /><button onClick={addWalletTask} className="p-2 bg-gray-200 rounded-xl"><Plus size={16}/></button></div><div className="space-y-2 max-h-40 overflow-y-auto">{(myWallet?.tasks || []).map((t: any) => (<div key={t.id} className="flex items-center gap-3 group"><button onClick={() => toggleWalletTask(t.id)}>{t.done ? <CheckCircle2 size={16} className="text-green-500"/> : <Square size={16} className="text-gray-300"/>}</button><span className={`text-sm font-bold flex-1 ${t.done ? 'line-through text-gray-300' : 'text-gray-600'}`}>{t.text}</span><button onClick={() => deleteWalletTask(t.id)} className="opacity-0 group-hover:opacity-100 text-red-300"><X size={14}/></button></div>))}</div></div>
          </div>
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-gray-100 h-80 relative" id="wallet-graph"><div className="flex justify-between items-center mb-4"><h3 className="text-xs font-black uppercase tracking-widest text-gray-400">Évolution du Solde</h3><div className="flex bg-gray-100 p-1 rounded-lg">{(['1M', '1Y', '5Y'] as const).map(range => (<button key={range} onClick={() => setChartRange(range)} className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${chartRange === range ? 'bg-white shadow text-black' : 'text-gray-400'}`}>{range}</button>))}</div></div><div className="h-60 w-full p-2"><SimpleLineChart data={graphData} color={config.primaryColor} /></div></div>
            <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-gray-100"><div className="flex justify-between items-center mb-6"><h3 className="text-xs font-black uppercase tracking-widest text-gray-400 flex items-center gap-2"><History size={14}/> Historique (Ce Mois)</h3><span className="text-[10px] font-bold bg-gray-100 px-3 py-1 rounded-full text-gray-500">{new Date().toLocaleString('default', { month: 'long' })}</span></div><div className="space-y-4 max-h-60 overflow-y-auto pr-2">{currentMonthHistory.length === 0 && <div className="text-center text-gray-300 italic py-4">Aucun mouvement ce mois-ci</div>}{currentMonthHistory.slice().reverse().map((h: any, i: number) => (<div key={i} className="flex justify-between items-center p-3 bg-gray-50 rounded-2xl"><div className="flex items-center gap-3"><div className={`p-2 rounded-full ${h.amount > 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>{h.amount > 0 ? <TrendingUp size={16}/> : <TrendingDown size={16}/>}</div><div className="text-xs font-bold text-gray-400 uppercase">{new Date(h.date).toLocaleDateString()}</div></div><span className={`font-black ${h.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>{h.amount > 0 ? '+' : ''}{h.amount}€</span></div>))}</div></div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 5. ADMIN PANEL (CORRIGÉ & STRUCTURÉ)
// ============================================================================

const AdminPanel = ({ config, save, add, del, upd, events, recipes, xsitePages, versions, restore, arch, chat, prompt, setP, load, hist, users, refreshUsers }: any) => {
  const [tab, setTab] = useState('users');
  const [newUser, setNewUser] = useState({ email: '', letter: '', name: '' });
  const [localC, setLocalC] = useState(config);
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [tempVersionName, setTempVersionName] = useState('');
  
  const [currentXSite, setCurrentXSite] = useState({ id: '', name: '', html: '' });
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  
  const [notif, setNotif] = useState<Partial<AppNotification>>({ message: '', type: 'info', repeat: 'once', linkView: '', linkId: '', targets: ['all'] });
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [activeNotifs, setActiveNotifs] = useState<AppNotification[]>([]);

  useEffect(() => {
      const q = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'));
      const unsub = onSnapshot(q, (s) => setActiveNotifs(s.docs.map(d => ({id:d.id, ...d.data()} as AppNotification))));
      return () => unsub();
  }, []);

  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setLocalC(config); }, [config]);
  
  const handleFile = (e: any, cb: any) => { const f = e.target.files[0]; if(f) { const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(f); }};
  const startEditVersion = (v: any) => { setEditingVersionId(v.id); setTempVersionName(v.name); };
  const saveVersionName = (id: string) => { upd('site_versions', id, { name: tempVersionName }); setEditingVersionId(null); };

  const generateQrCode = (siteId: string) => { const baseUrl = window.location.href.split('?')[0]; const fullUrl = `${baseUrl}?id=${siteId}`; const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(fullUrl)}`; setQrCodeUrl(apiUrl); };
  const copyCookingLink = () => { const baseUrl = window.location.href.split('?')[0]; const fullUrl = `${baseUrl}?view=cooking`; navigator.clipboard.writeText(fullUrl); alert("Lien copié !"); };
  const registerUser = async () => { if(!newUser.email || !newUser.letter) return alert("Email et Lettre requis"); await setDoc(doc(db, 'site_users', newUser.email), { ...newUser, createdAt: new Date().toISOString() }); setNewUser({ email: '', letter: '', name: '' }); alert("Utilisateur ajouté !"); };

  const sendNotification = async () => {
      if(!notif.message) return alert("Message vide");
      let scheduledISO = undefined;
      if (schedDate && schedTime) { scheduledISO = new Date(`${schedDate}T${schedTime}`).toISOString(); }
      await addDoc(collection(db, 'notifications'), { ...notif, targets: notif.targets?.length ? notif.targets : ['all'], scheduledFor: scheduledISO, createdAt: new Date().toISOString(), readBy: {} });
      setNotif({ message: '', type: 'info', repeat: 'once', linkView: '', linkId: '', targets: ['all'] }); setSchedDate(''); setSchedTime(''); alert("Notification envoyée/programmée !");
  };

  const sendEmailToAll = () => {
      let recipients = ""; if (notif.targets?.includes('all')) { recipients = users.map((u:any) => u.id).join(','); } else { recipients = notif.targets?.join(',') || ""; }
      let linkText = "";
      if (notif.linkView) { const baseUrl = window.location.href.split('?')[0]; let url = `${baseUrl}?view=${notif.linkView}`; if (notif.linkView === 'xsite' && notif.linkId) { url += `&id=${notif.linkId}`; } else if (notif.linkId) { url += `&anchor=${notif.linkId}`; } linkText = `%0A%0ALien direct : ${url}`; }
      const body = `Bonjour,%0A%0A${notif.message || "Nouvelle notification !"}${linkText}`;
      window.location.href = `mailto:?bcc=${recipients}&subject=Message%20Chaud%20Devant&body=${body}`;
  };

  return (
    <div className="bg-white/90 backdrop-blur-xl rounded-[2.5rem] shadow-2xl h-[80vh] border border-black/5 flex flex-col md:flex-row overflow-hidden">
        
        {/* SIDEBAR GAUCHE (Menu) */}
        <nav className="w-full md:w-64 bg-gray-50/50 p-6 flex flex-col gap-6 border-r border-gray-100 overflow-y-auto shrink-0">
            <div>
                <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-3">Famille</h4>
                <div className="space-y-1">
                    <button onClick={() => setTab('users')} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-3 ${tab==='users' ? 'bg-black text-white shadow-lg' : 'hover:bg-white text-gray-600'}`}><Users size={16}/> Utilisateurs</button>
                    <button onClick={() => setTab('notif')} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-3 ${tab==='notif' ? 'bg-black text-white shadow-lg' : 'hover:bg-white text-gray-600'}`}><Bell size={16}/> Notifications</button>
                </div>
            </div>

            <div>
                <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-3">Contenu</h4>
                <div className="space-y-1">
                    <button onClick={() => setTab('xsite')} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-3 ${tab==='xsite' ? 'bg-black text-white shadow-lg' : 'hover:bg-white text-gray-600'}`}><Map size={16}/> XSite Web</button>
                    <button onClick={() => setTab('code')} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-3 ${tab==='code' ? 'bg-black text-white shadow-lg' : 'hover:bg-white text-gray-600'}`}><Code size={16}/> Code Semainier</button>
                </div>
            </div>

            <div>
                <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-3">Système</h4>
                <div className="space-y-1">
                    <button onClick={() => setTab('home')} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-3 ${tab==='home' ? 'bg-black text-white shadow-lg' : 'hover:bg-white text-gray-600'}`}><Home size={16}/> Accueil</button>
                    <button onClick={() => setTab('history')} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-3 ${tab==='history' ? 'bg-black text-white shadow-lg' : 'hover:bg-white text-gray-600'}`}><History size={16}/> Historique</button>
                    <button onClick={() => setTab('arch')} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-3 ${tab==='arch' ? 'bg-black text-white shadow-lg' : 'hover:bg-white text-gray-600'}`}><Sparkles size={16}/> Architecte IA</button>
                </div>
            </div>
            
            <div className="mt-auto pt-6 border-t border-gray-200">
                <button onClick={() => window.location.reload()} className="w-full text-left px-4 py-3 rounded-xl text-xs font-bold uppercase text-red-400 hover:bg-red-50 flex items-center gap-3"><LogOut size={16}/> Quitter Admin</button>
            </div>
        </nav>

        {/* CONTENU DROITE (Scrollable) */}
        <main className="flex-1 p-8 overflow-y-auto bg-white/50">
            {tab === 'users' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                    <h3 className="text-3xl font-cinzel font-bold text-gray-800">GESTION UTILISATEURS</h3>
                    <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100">
                        <h4 className="font-bold mb-4 text-xs uppercase tracking-widest text-gray-400">Ajouter un membre</h4>
                        <div className="flex flex-col md:flex-row gap-4">
                            <input value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} placeholder="Email (ex: pauline...)" className="flex-1 p-4 rounded-2xl border-none shadow-sm font-bold text-sm outline-none" />
                            <input value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} placeholder="Prénom" className="w-32 p-4 rounded-2xl border-none shadow-sm font-bold text-sm outline-none" />
                            <input value={newUser.letter} onChange={e => setNewUser({...newUser, letter: e.target.value})} placeholder="Lettre (P)" className="w-24 p-4 rounded-2xl border-none shadow-sm font-bold text-sm text-center outline-none" />
                            <button onClick={registerUser} className="bg-black text-white p-4 rounded-2xl shadow-lg hover:scale-105 transition-transform"><Plus/></button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {users.map((u:any) => (
                            <div key={u.id} className="flex items-center justify-between p-5 bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center font-black text-gray-500 text-lg">{u.letter}</div>
                                    <div><div className="font-bold text-lg">{u.name || 'Sans nom'}</div><div className="text-xs text-gray-400">{u.id}</div></div>
                                </div>
                                <div className="text-right"><div className="text-[10px] font-bold uppercase text-green-600 bg-green-50 px-3 py-1 rounded-full">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : 'Jamais'}</div></div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {tab === 'notif' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                    <h3 className="text-3xl font-cinzel font-bold text-gray-800">NOTIFICATIONS</h3>
                    
                    <div className="bg-white p-8 rounded-[2.5rem] shadow-lg border border-gray-100 space-y-6">
                        <div>
                            <label className="text-xs font-black uppercase text-gray-400 mb-2 block">Message</label>
                            <textarea value={notif.message} onChange={e => setNotif({...notif, message: e.target.value})} className="w-full p-4 rounded-2xl bg-gray-50 border-none font-bold text-gray-700 outline-none h-24 resize-none" placeholder="Quoi de neuf ?" />
                        </div>

                        <div>
                            <label className="text-xs font-black uppercase text-gray-400 mb-2 block">Cible (Qui reçoit ?)</label>
                            <div className="flex flex-wrap gap-2">
                                <button onClick={() => setNotif({...notif, targets: ['all']})} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${notif.targets?.includes('all') ? 'bg-black text-white shadow-lg' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>TOUS</button>
                                {users.map((u: any) => (
                                    <button key={u.id} onClick={() => { const current = notif.targets?.includes('all') ? [] : (notif.targets || []); const newTargets = current.includes(u.id) ? current.filter(t => t !== u.id) : [...current, u.id]; setNotif({...notif, targets: newTargets}); }} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${notif.targets?.includes(u.id) ? 'bg-blue-500 text-white shadow-lg' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{u.name || u.letter}</button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="text-xs font-black uppercase text-gray-400 mb-2 block">Redirection (Optionnel)</label>
                                <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-2xl">
                                    <select value={notif.linkView} onChange={e => setNotif({...notif, linkView: e.target.value, linkId: ''})} className="bg-transparent text-sm font-bold outline-none w-full p-2"><option value="">-- Page --</option>{Object.keys(ORIGINAL_CONFIG.navigationLabels).map(key => (<option key={key} value={key}>{ORIGINAL_CONFIG.navigationLabels[key as keyof typeof ORIGINAL_CONFIG.navigationLabels]}</option>))}</select>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-black uppercase text-gray-400 mb-2 block">Programmation</label>
                                <div className="flex gap-2 items-center bg-gray-50 p-2 rounded-2xl">
                                    <CalendarClock size={16} className="text-gray-400 ml-2"/>
                                    <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} className="bg-transparent text-xs font-bold outline-none"/>
                                    <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)} className="bg-transparent text-xs font-bold outline-none"/>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <button onClick={sendNotification} className="flex-1 py-4 bg-black text-white rounded-2xl font-bold uppercase tracking-widest shadow-xl hover:scale-[1.02] transition-transform">Envoyer Interne</button>
                            <button onClick={sendEmailToAll} className="px-6 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-colors"><Mail/></button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        {activeNotifs.map(n => (
                            <div key={n.id} className="flex justify-between items-center p-4 bg-white rounded-2xl border border-gray-100">
                                <div>
                                    <div className="flex gap-2 mb-1">
                                        <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${n.type === 'alert' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>{n.type}</span>
                                        {n.scheduledFor && <span className="text-[10px] font-bold bg-orange-100 text-orange-600 px-2 py-1 rounded flex items-center gap-1"><Clock size={10}/> {new Date(n.scheduledFor).toLocaleString()}</span>}
                                    </div>
                                    <span className="font-bold text-gray-800">{n.message}</span>
                                </div>
                                <button onClick={() => deleteDoc(doc(db, 'notifications', n.id))} className="p-2 text-gray-400 hover:text-red-500"><Trash2 size={16}/></button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {tab === 'home' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                    <h3 className="text-3xl font-cinzel font-bold text-gray-800">ACCUEIL</h3>
                    <div className="space-y-4">
                        <input value={localC.welcomeTitle} onChange={e => setLocalC({...localC, welcomeTitle: e.target.value})} className="w-full p-6 rounded-3xl border border-gray-200 text-2xl font-black font-cinzel" placeholder="Titre" />
                        <textarea value={localC.welcomeText} onChange={e => setLocalC({...localC, welcomeText: e.target.value})} className="w-full p-6 rounded-3xl border border-gray-200 h-32 font-medium" placeholder="Texte de bienvenue" />
                        <div className="flex gap-4">
                            <div onClick={() => fileRef.current?.click()} className="flex-1 p-8 border-2 border-dashed border-gray-300 rounded-3xl text-center cursor-pointer hover:bg-gray-50 flex flex-col items-center justify-center gap-2 text-gray-400">
                                <ImageIcon size={32}/>
                                <span className="font-bold text-xs uppercase">Changer Photo</span>
                            </div>
                            <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e => handleFile(e, (b: string) => setLocalC({...localC, welcomeImage: b}))} />
                            
                            <textarea value={localC.homeHtml} onChange={e => setLocalC({...localC, homeHtml: e.target.value})} className="flex-1 p-6 rounded-3xl border border-gray-200 font-mono text-xs" placeholder="Widget HTML (Météo, etc...)" />
                        </div>
                        <button onClick={() => save(localC, true)} className="w-full py-5 bg-black text-white rounded-2xl font-black shadow-xl uppercase hover:scale-[1.02] transition-transform">Sauvegarder les changements</button>
                    </div>
                </div>
            )}
            
            {tab === 'history' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                   <h3 className="text-3xl font-cinzel font-bold text-gray-800">HISTORIQUE</h3>
                   <div className="grid grid-cols-1 gap-4">
                     {versions.map((v: SiteVersion) => (
                       <div key={v.id} className="flex justify-between items-center p-6 bg-white rounded-3xl border border-gray-100 shadow-sm">
                         <div>
                             <div className="font-bold text-lg">{v.name}</div>
                             <div className="text-xs text-gray-400 mt-1">{new Date(v.date).toLocaleString()}</div>
                         </div>
                         <div className="flex gap-2">
                             <button onClick={() => restore(v)} className="px-4 py-2 bg-black text-white rounded-xl text-xs font-bold uppercase hover:bg-gray-800">Restaurer</button>
                             <button onClick={() => del('site_versions', v.id)} className="p-2 text-red-300 hover:text-red-500"><Trash2 size={18}/></button>
                         </div>
                       </div>
                     ))}
                   </div>
                </div>
            )}

            {tab === 'arch' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                   <h3 className="text-3xl font-cinzel font-bold text-gray-800">ARCHITECTE IA</h3>
                   <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-8 rounded-[3rem] text-white shadow-2xl">
                       <p className="font-bold text-sm uppercase tracking-widest opacity-70 mb-4">Design Automatique</p>
                       <textarea value={prompt} onChange={e => setP(e.target.value)} className="w-full p-6 rounded-3xl bg-white/20 border border-white/30 text-white placeholder-white/50 h-40 focus:ring-4 outline-none text-xl font-bold" placeholder="Ex: 'Je veux un style sombre et élégant pour l'hiver'..." />
                       <button onClick={arch} disabled={load} className="w-full mt-6 py-5 bg-white text-indigo-600 rounded-2xl font-black uppercase shadow-xl hover:scale-[1.02] transition-transform">
                           {load ? <Loader2 className="animate-spin mx-auto"/> : "Transformer le design"}
                       </button>
                   </div>
                </div>
            )}

            {tab === 'xsite' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                    <h3 className="text-3xl font-cinzel font-bold text-gray-800">GESTION XSITE</h3>
                    {qrCodeUrl && (
                        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4" onClick={() => setQrCodeUrl(null)}>
                            <div className="bg-white p-8 rounded-3xl text-center space-y-4 animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                                <h4 className="font-cinzel font-bold text-xl">SCANNEZ CE CODE</h4>
                                <img src={qrCodeUrl} alt="QR Code" className="mx-auto border-4 border-black rounded-xl"/>
                                <button onClick={() => setQrCodeUrl(null)} className="mt-4 px-8 py-3 bg-black text-white rounded-2xl font-bold uppercase">Fermer</button>
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       {xsitePages.map((site: any) => (
                          <div key={site.id} className="p-6 bg-white rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between h-40">
                             <span className="font-black text-xl">{site.name}</span>
                             <div className="flex gap-2 mt-auto">
                                <button onClick={() => generateQrCode(site.id)} className="flex-1 py-2 bg-black text-white rounded-xl text-xs font-bold uppercase"><QrCode className="inline mr-2" size={14}/>QR</button>
                                <button onClick={() => setCurrentXSite(site)} className="p-2 bg-blue-50 text-blue-600 rounded-xl"><Pencil size={16}/></button>
                                <button onClick={() => del('xsite_pages', site.id)} className="p-2 bg-red-50 text-red-600 rounded-xl"><Trash2 size={16}/></button>
                             </div>
                          </div>
                       ))}
                    </div>
                    <hr className="border-gray-100"/>
                    <div className="bg-white p-8 rounded-[2.5rem] shadow-lg border border-gray-100 space-y-4">
                        <h4 className="text-sm font-bold uppercase tracking-widest text-gray-400">{currentXSite.id ? 'Modifier' : 'Nouveau Site'}</h4>
                        <input value={currentXSite.name} onChange={e => setCurrentXSite({...currentXSite, name: e.target.value})} className="w-full p-4 rounded-2xl border border-gray-200 font-bold outline-none" placeholder="Nom du fichier" />
                        <textarea value={currentXSite.html} onChange={e => setCurrentXSite({...currentXSite, html: e.target.value})} className="w-full p-4 rounded-2xl border border-gray-200 font-mono text-xs h-64 outline-none" placeholder="Code HTML..." />
                        <button onClick={() => { if(currentXSite.id) { upd('xsite_pages', currentXSite.id, currentXSite); } else { add('xsite_pages', currentXSite); } setCurrentXSite({id:'', name:'', html:''}); }} className="w-full py-4 bg-black text-white font-bold rounded-2xl uppercase shadow-lg hover:scale-[1.02] transition-transform">Sauvegarder</button>
                    </div>
                </div>
            )}

            {tab === 'code' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                   <h3 className="text-3xl font-cinzel font-bold text-gray-800">CODE SEMAINIER</h3>
                   <div className="bg-gray-900 p-6 rounded-3xl shadow-2xl">
                       <textarea value={localC.cookingHtml} onChange={e => setLocalC({...localC, cookingHtml: e.target.value})} className="w-full bg-transparent text-green-400 font-mono text-xs h-96 outline-none resize-none" placeholder="<iframe>..." />
                   </div>
                   <div className="flex gap-4">
                      <button onClick={() => save(localC, true)} className="flex-1 py-5 bg-black text-white rounded-2xl font-black shadow-xl uppercase hover:scale-[1.02] transition-transform">Sauvegarder</button>
                      <button onClick={copyCookingLink} className="px-8 py-5 bg-white text-black border border-gray-200 rounded-2xl font-bold shadow-xl hover:bg-gray-50"><Copy size={20}/></button>
                   </div>
                </div>
            )}
        </main>
    </div>
  );
};

// ============================================================================
// 6. COMPOSANT APP PRINCIPAL
// ============================================================================

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  
  // Données
  const [config, setConfig] = useState<SiteConfig>(ORIGINAL_CONFIG);
  const [xsitePages, setXsitePages] = useState<any[]>([]); 
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [versions, setVersions] = useState<SiteVersion[]>([]);
  const [choreStatus, setChoreStatus] = useState<Record<string, any>>({});
  const [favorites, setFavorites] = useState<string[]>([]);
  const [siteUsers, setSiteUsers] = useState<any[]>([]);
  const [usersMapping, setUsersMapping] = useState<Record<string, string>>({});
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  
  // États UI
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false); 
  const [selectedXSite, setSelectedXSite] = useState<any>(null);
  const [currentView, setCurrentView] = useState<ViewType | 'wallet' | 'xsite' | 'hub' | 'fridge'>('home');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [newEvent, setNewEvent] = useState({ title: '', date: new Date().toISOString().split('T')[0], time: '', isAllDay: true });
  const [currentRecipe, setCurrentRecipe] = useState<any>({ id: '', title: '', chef: '', ingredients: '', steps: '', category: 'plat', image: '' });
  const [aiPrompt, setAiPrompt] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: string, text: string }[]>([]);
  const [aiLink, setAiLink] = useState('');

  // 1. AUTHENTIFICATION & USER SYNC
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => { 
      setUser(u); setIsInitializing(false); 
      if (u && u.email) {
         try {
             await setDoc(doc(db, 'site_users', u.email), { lastLogin: new Date().toISOString(), email: u.email }, { merge: true });
             const prefsDoc = await getDoc(doc(db, 'user_prefs', u.email));
             if (prefsDoc.exists()) setFavorites(prefsDoc.data().favorites || []);
         } catch(e) { console.error("Err sync user", e); }
      }
    });
    return () => unsubscribe();
  }, []);

  const isAuthorized = user && user.email && (siteUsers.find(u => u.id === user.email) || user.email === ADMIN_EMAIL);
  const myLetter = user && user.email ? (usersMapping[user.email] || user.email.charAt(0).toUpperCase()) : null;

  // 2. CHARGEMENT DONNÉES
  useEffect(() => {
    if (!user) return;
    const unsubC = onSnapshot(doc(db, 'site_config', 'main'), (d) => { if (d.exists()) setConfig(d.data() as SiteConfig); });
    const unsubX = onSnapshot(query(collection(db, 'xsite_pages'), orderBy('timestamp', 'desc')), (s) => setXsitePages(s.docs.map(d => ({ ...d.data(), id: d.id }))));
    const unsubR = onSnapshot(collection(db, 'family_recipes'), (s) => setRecipes(s.docs.map(d => ({ ...d.data(), id: d.id } as Recipe))));
    const unsubE = onSnapshot(collection(db, 'family_events'), (s) => { const rawEvents = s.docs.map(d => ({ ...d.data(), id: d.id } as FamilyEvent)); rawEvents.sort((a, b) => a.date.localeCompare(b.date)); setEvents(rawEvents); });
    const unsubV = onSnapshot(query(collection(db, 'site_versions'), orderBy('date', 'desc')), (s) => setVersions(s.docs.map(d => ({ ...d.data(), id: d.id } as SiteVersion))));
    const unsubT = onSnapshot(collection(db, 'chores_status'), (s) => { const status: Record<string, any> = {}; s.docs.forEach(doc => { status[doc.id] = doc.data(); }); setChoreStatus(status); });
    const unsubU = onSnapshot(collection(db, 'site_users'), (s) => { const users = s.docs.map(d => ({id: d.id, ...d.data()})); setSiteUsers(users); const newMap: Record<string, string> = {}; users.forEach((u: any) => { if(u.letter) newMap[u.id] = u.letter; }); setUsersMapping(newMap); });
    const unsubN = onSnapshot(query(collection(db, 'notifications'), orderBy('createdAt', 'desc')), (s) => {
        const rawNotifs = s.docs.map(d => ({id: d.id, ...d.data()} as AppNotification));
        const visibleNotifs = rawNotifs.filter(n => {
            if(!user.email) return false;
            if (n.targets && !n.targets.includes('all') && !n.targets.includes(user.email)) return false;
            if (n.scheduledFor && new Date() < new Date(n.scheduledFor)) return false;
            const readDate = n.readBy[user.email];
            if(!readDate) return true;
            const lastRead = new Date(readDate); const now = new Date();
            if(n.repeat === 'once') return false; 
            if(n.repeat === 'daily') return lastRead.getDate() !== now.getDate(); 
            if(n.repeat === 'monthly') return lastRead.getMonth() !== now.getMonth();
            return true;
        });
        setNotifications(visibleNotifs);
    });
    return () => { unsubC(); unsubX(); unsubR(); unsubE(); unsubV(); unsubT(); unsubU(); unsubN(); };
  }, [user]);

  // 3. DEEP LINKING
  useEffect(() => {
     const params = new URLSearchParams(window.location.search);
     const targetView = params.get('view');
     if (targetView) {
         setCurrentView(targetView as any);
         if (targetView === 'xsite') {
             const siteId = params.get('id');
             if (siteId && xsitePages.length > 0) { const foundSite = xsitePages.find(p => p.id === siteId); if (foundSite) setSelectedXSite(foundSite); }
         }
         const anchorId = params.get('anchor');
         if (anchorId) { setTimeout(() => { const element = document.getElementById(anchorId); if (element) { element.scrollIntoView({ behavior: 'smooth', block: 'start' }); element.classList.add('ring-4', 'ring-offset-2', 'ring-orange-400', 'transition-all', 'duration-1000'); setTimeout(() => element.classList.remove('ring-4', 'ring-offset-2', 'ring-orange-400'), 2000); } }, 800); }
         window.history.replaceState({}, document.title, window.location.pathname);
     }
  }, [xsitePages]);

  // ACTIONS
  const handleLogin = async () => { try { await signInWithPopup(auth, googleProvider); } catch (e) { alert("Erreur Auth"); } };
  const handleLogout = () => { signOut(auth); setCurrentView('home'); };
  const saveConfig = async (c: SiteConfig, saveHistory = false) => { try { await setDoc(doc(db, 'site_config', 'main'), c); setConfig(c); if(saveHistory) await addDoc(collection(db, 'site_versions'), { name: `Sauvegarde`, date: new Date().toISOString(), config: c }); } catch(e) { console.error(e); } };
  const restoreVersion = (v: SiteVersion) => { if(confirm(`Restaurer la version "${v.name}" ?`)) saveConfig(v.config, false); };
  const addEntry = async (col: string, data: any) => { try { const { id, ...cleanData } = data; await addDoc(collection(db, col), { ...cleanData, timestamp: serverTimestamp() }); } catch(e) { alert("Erreur ajout"); } };
  const updateEntry = async (col: string, id: string, data: any) => { try { const { id: _, ...c } = data; await setDoc(doc(db, col, id), { ...c, timestamp: serverTimestamp() }, { merge: true }); alert("Sauvegardé"); } catch (e) { alert("Erreur"); } };
  const deleteItem = async (col: string, id: string) => { if(!id) { alert("Erreur ID"); return; } if(confirm("Supprimer ?")) { try { await deleteDoc(doc(db, col, id)); } catch(e) { alert("Erreur suppression"); } } };
  const toggleChore = async (weekId: string, letter: string) => { try { const currentStatus = choreStatus[weekId]?.[letter] || false; await setDoc(doc(db, 'chores_status', weekId), { [letter]: !currentStatus }, { merge: true }); } catch (e) { console.error("Erreur coche", e); } };
  const toggleFavorite = async (siteId: string) => { if (!user || !user.email) return; const ref = doc(db, 'user_prefs', user.email); try { if (favorites.includes(siteId)) { await setDoc(ref, { favorites: arrayRemove(siteId) }, { merge: true }); setFavorites(prev => prev.filter(id => id !== siteId)); } else { await setDoc(ref, { favorites: arrayUnion(siteId) }, { merge: true }); setFavorites(prev => [...prev, siteId]); } } catch (e) { console.error("Error toggle fav", e); } };
  const openEditRecipe = (recipe: any) => { const ingredientsStr = Array.isArray(recipe.ingredients) ? recipe.ingredients.join('\n') : recipe.ingredients; const stepsStr = recipe.steps || recipe.instructions || ''; setCurrentRecipe({ ...recipe, ingredients: ingredientsStr, steps: stepsStr }); setIsRecipeModalOpen(true); };
  
  const handleArchitect = async () => { if (!aiPrompt.trim()) return; setIsAiLoading(true); const n = await askAIArchitect(aiPrompt, config); if (n) { const newConfig = {...config, ...n, welcomeImage: n.welcomeImage || config.welcomeImage }; if(n.welcomeImage !== config.welcomeImage) { await saveConfig(newConfig, true); } else { await saveConfig(newConfig, false); } } setIsAiLoading(false); };
  
  const handleAiRecipe = async () => { if (!aiLink.trim()) return; setIsAiLoading(true); const res = await extractRecipeFromUrl(aiLink); if (res) setCurrentRecipe({ ...currentRecipe, ...res }); setAiLink(''); setIsAiLoading(false); };
  
  // ACTION MAJORDOME (Ajout automatique aux courses)
  const handleButlerAction = async (action: string, item: string) => {
      if (action === 'ADD_HUB') {
          // Ajout automatique au Hub
          await addEntry('hub_items', {
              type: 'shop',
              content: item,
              category: 'Majordome',
              store: 'Divers',
              author: 'Majordome',
              createdAt: new Date().toISOString(),
              done: false
          });
      }
  };
  
  const handleNotificationClick = (n: AppNotification) => { markNotifRead(n.id); if (n.linkView) { setCurrentView(n.linkView as any); if (n.linkView === 'xsite' && n.linkId) { const site = xsitePages.find(p => p.id === n.linkId); if (site) setSelectedXSite(site); } else if (n.linkId) { setTimeout(() => { const element = document.getElementById(n.linkId!); if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 500); } } setIsNotifOpen(false); };
  const markNotifRead = async (notifId: string) => { if(!user?.email) return; const notifRef = doc(db, 'notifications', notifId); await setDoc(notifRef, { readBy: { [user.email]: new Date().toISOString() } }, { merge: true }); };

  if (isInitializing) return <div className="min-h-screen flex items-center justify-center bg-[#f5ede7]"><Loader2 className="w-12 h-12 animate-spin text-[#a85c48]"/></div>;
  if (!user) return <div className="fixed inset-0 flex flex-col items-center justify-center p-6 bg-[#f5ede7]"><Background color={ORIGINAL_CONFIG.primaryColor} /><div className="z-10 text-center space-y-8 animate-in fade-in zoom-in duration-700"><div className="mx-auto w-24 h-24 rounded-[2.5rem] flex items-center justify-center shadow-xl bg-[#a85c48]"><Sparkles className="text-white" size={48} /></div><h1 className="text-4xl font-cinzel font-black tracking-widest text-[#a85c48]">CHAUD DEVANT</h1><button onClick={handleLogin} className="bg-white text-black font-black py-4 px-8 rounded-2xl shadow-xl flex items-center gap-3 hover:scale-105 transition-transform"><LogIn size={24} /> CONNEXION GOOGLE</button></div></div>;
  if (!isAuthorized) return <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-red-50 text-center space-y-8"><ShieldAlert className="text-red-500 w-20 h-20" /><h2 className="text-3xl font-bold text-red-800 font-cinzel">ACCÈS RESTREINT</h2><p>Contactez Gabriel pour valider votre compte.</p><button onClick={handleLogout} className="px-6 py-4 bg-red-500 text-white font-bold rounded-2xl">Déconnexion</button></div>;

  return (
    <div className="min-h-screen pb-24 md:pb-0 transition-colors duration-700" style={{ backgroundColor: config.backgroundColor, fontFamily: config.fontFamily }}>
      <Background color={config.primaryColor} />
      
      {/* NOTIFICATIONS MODAL */}
      {isNotifOpen && (
          <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm flex justify-end" onClick={() => setIsNotifOpen(false)}>
              <div className="w-full max-w-sm bg-white h-full p-6 animate-in slide-in-from-right shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <h3 className="text-2xl font-cinzel font-bold mb-6 flex items-center gap-2"><Bell className="text-orange-500"/> Notifications</h3>
                  <div className="space-y-4">
                      {notifications.length === 0 && <p className="text-gray-400 italic text-center">Aucune nouvelle notification.</p>}
                      {notifications.map(n => (
                          <div key={n.id} className={`p-4 rounded-xl border-l-4 ${n.type === 'alert' ? 'bg-red-50 border-red-500' : 'bg-blue-50 border-blue-500'}`}>
                              <p className="font-bold text-gray-800 mb-2">{n.message}</p>
                              {n.linkView && (<button onClick={() => handleNotificationClick(n)} className="w-full py-2 bg-black text-white rounded-lg text-xs font-bold uppercase mb-2">Aller voir</button>)}
                              <div className="flex justify-between items-center mt-1"><span className="text-[10px] uppercase text-gray-400">{new Date(n.createdAt).toLocaleDateString()}</span><button onClick={() => markNotifRead(n.id)} className="text-xs font-bold px-3 py-1 bg-white rounded-lg shadow-sm border hover:bg-gray-50">Marquer lu</button></div>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      )}

      {/* IMMERSIVE XSITE VIEWER */}
      {currentView === 'xsite' && selectedXSite && (
          <div className="fixed inset-0 z-[100] bg-white flex flex-col animate-in fade-in slide-in-from-bottom-10">
             <div className="h-16 border-b flex items-center justify-between px-4 bg-white shadow-sm z-10">
                 <button onClick={() => { setSelectedXSite(null); }} className="flex items-center gap-2 text-sm font-bold text-gray-600 hover:text-black transition-colors"><ArrowLeft size={20}/> Retour</button>
                 <span className="font-cinzel font-bold text-lg truncate">{selectedXSite.name}</span>
                 <button onClick={() => toggleFavorite(selectedXSite.id)} className="p-2 transition-transform active:scale-95"><Star size={24} className={favorites.includes(selectedXSite.id) ? "fill-yellow-400 text-yellow-400" : "text-gray-300"} /></button>
             </div>
             <iframe srcDoc={selectedXSite.html} className="flex-1 w-full border-none" title={selectedXSite.name} sandbox="allow-scripts allow-same-origin"/>
          </div>
      )}

      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-xl border-b border-black/5 z-50 h-20 px-6 flex items-center justify-between">
        <div onClick={() => setCurrentView('home')} className="flex items-center gap-3 cursor-pointer">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ backgroundColor: config.primaryColor }}><Home className="text-white" size={20} /></div>
          <span className="font-cinzel font-black text-xl hidden md:block" style={{ color: config.primaryColor }}>CHAUD.DEVANT</span>
        </div>
        <div className="flex gap-4 items-center">
           <div className="hidden md:flex gap-6">
             {Object.keys(NAV_ITEMS).filter(k => k !== 'edit').map(key => (
               <button key={key} onClick={() => setCurrentView(key as any)} className="text-xs font-black tracking-widest opacity-40 hover:opacity-100 uppercase" style={{ color: currentView === key ? config.primaryColor : 'inherit' }}>{NAV_ITEMS[key as keyof typeof NAV_ITEMS]}</button>
             ))}
           </div>
           <button onClick={() => setIsNotifOpen(true)} className="relative p-2 text-gray-400 hover:text-black transition-colors"><Bell size={24}/>{notifications.length > 0 && <span className="absolute top-1 right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>}</button>
           <button className="md:hidden" onClick={() => setIsMenuOpen(true)} style={{ color: config.primaryColor }}><Menu size={28} /></button>
           <button className="hidden md:block" onClick={() => setIsMenuOpen(true)} style={{ color: config.primaryColor }}><Menu size={20}/></button>
        </div>
      </nav>

      <SideMenu config={config} isOpen={isMenuOpen} close={() => setIsMenuOpen(false)} setView={setCurrentView} logout={handleLogout} />
      <BottomNav config={config} view={currentView} setView={setCurrentView} />

      <main className="max-w-7xl mx-auto px-6 pt-28 pb-32 relative z-10">
        
        {currentView === 'home' && (
          <div className="space-y-16 animate-in fade-in duration-1000" id="top">
            <section className="relative h-[60vh] rounded-[3rem] overflow-hidden shadow-2xl group">
              <img src={config.welcomeImage} className="w-full h-full object-cover transition-transform duration-[10s] group-hover:scale-110" />
              <div className="absolute inset-0 bg-black/40 flex flex-col justify-end p-10">
                <h1 className="text-5xl md:text-8xl font-cinzel font-black text-white leading-none">{config.welcomeTitle}</h1>
                <p className="text-xl text-white/90 italic mt-4">{config.welcomeText}</p>
                <button onClick={() => setCurrentView('hub')} className="mt-8 bg-white text-black px-8 py-4 rounded-xl font-bold uppercase tracking-widest shadow-xl flex items-center gap-3 w-fit hover:scale-105 transition-transform"><LayoutDashboard/> Ouvrir le Tableau</button>
              </div>
            </section>
            
            {config.homeHtml && (<section id="home-widget" className="bg-white/50 rounded-[3rem] overflow-hidden shadow-xl mb-8"><iframe srcDoc={config.homeHtml} className="w-full h-[500px]" sandbox="allow-scripts" title="Home Widget" /></section>)}
            
            <div className="grid md:grid-cols-2 gap-8" id="home-shortcuts">
              <HomeCard icon={<CalIcon size={40}/>} title="Semainier" label="Menus & Organisation" onClick={() => setCurrentView('cooking')} color={config.primaryColor} />
              <HomeCard icon={<UtensilsCrossed size={40}/>} title="Frigo" label="Scanner IA" onClick={() => setCurrentView('fridge')} color={config.primaryColor} />
              <HomeCard icon={<LayoutDashboard size={40}/>} title="Tableau" label="Courses & Notes" onClick={() => setCurrentView('hub')} color={config.primaryColor} />
              <HomeCard icon={<ChefHat size={40}/>} title="Recettes" label="Chef IA" onClick={() => setCurrentView('recipes')} color={config.primaryColor} />
            </div>
          </div>
        )}

        {/* --- LE HUB (TABLEAU DE BORD) --- */}
        {currentView === 'hub' && (
            <>
                <HubView user={user} config={config} usersMapping={usersMapping} onAddItem={addEntry} />
                {/* On passe le contexte au Majordome */}
                <ButlerFloating 
                    chatHistory={chatHistory} 
                    setChatHistory={setChatHistory} 
                    isAiLoading={isAiLoading} 
                    setIsAiLoading={setIsAiLoading} 
                    contextData={{ hubItems: [], fridgeItems: [] }} // TODO: Connecter avec les vrais items
                    onAction={handleButlerAction}
                />
            </>
        )}

        {/* --- FRIGO --- */}
        {currentView === 'fridge' && <FridgeView />}

        {/* --- PORTE-MONNAIE --- */}
        {currentView === 'wallet' && <WalletView user={user} config={config} />}

        {/* --- TÂCHES --- */}
        {currentView === 'tasks' && (
          <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-8" id="tasks-table">
            <div className="text-center space-y-4"><h2 className="text-5xl font-cinzel font-black" style={{ color: config.primaryColor }}>TÂCHES MÉNAGÈRES</h2><p className="text-gray-500 font-serif italic">{myLetter ? `Salut ${myLetter === 'G' ? 'Gabriel' : myLetter === 'P' ? 'Pauline' : 'Valentin'}, à l'attaque !` : "Connecte-toi avec ton compte perso pour participer."}</p></div>
            <div className="bg-white/90 backdrop-blur-xl rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/50">
              <div className="overflow-x-auto"><table className="w-full"><thead><tr className="text-left" style={{ backgroundColor: config.primaryColor + '15' }}><th className="p-4 font-black uppercase text-xs tracking-widest text-gray-500 w-24">Weekend</th><th className="p-4 font-black uppercase text-xs tracking-widest text-center" style={{ color: config.primaryColor }}>Aspi Haut</th><th className="p-4 font-black uppercase text-xs tracking-widest text-center" style={{ color: config.primaryColor }}>Aspi Bas</th><th className="p-4 font-black uppercase text-xs tracking-widest text-center" style={{ color: config.primaryColor }}>Lav/Douche</th><th className="p-4 w-10"></th></tr></thead><tbody className="divide-y divide-gray-100">{getMonthWeekends().map((week, i) => { const rowStatus = choreStatus[week.id] || {}; const isRowComplete = rowStatus.G && rowStatus.P && rowStatus.V; const now = new Date(); const isLocked = week.fullDate.getTime() > (now.getTime() + 86400000 * 6); return (<tr key={i} className={`transition-colors ${isRowComplete ? 'bg-green-50/50' : 'hover:bg-white/50'}`}><td className="p-4 font-mono font-bold text-gray-700 whitespace-nowrap text-sm">{week.dateStr}{isLocked && <span className="ml-2 text-xs text-gray-300">🔒</span>}</td><TaskCell weekId={week.id} letter={week.haut} label="Aspi Haut" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter} /><TaskCell weekId={week.id} letter={week.bas} label="Aspi Bas" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter} /><TaskCell weekId={week.id} letter={week.douche} label="Lavabo" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter} /><td className="p-4 text-center">{isRowComplete && <CheckCircle2 className="text-green-500 mx-auto animate-bounce" />}</td></tr>); })}</tbody></table></div>
              <div className="p-6 bg-gray-50 text-center text-xs text-gray-400 uppercase tracking-widest border-t border-gray-100">G = Gabriel • P = Pauline • V = Valentin</div>
            </div>
          </div>
        )}

        {/* --- CALENDRIER --- */}
        {currentView === 'calendar' && (
           <div className="max-w-3xl mx-auto space-y-10" id="calendar-view">
             <div className="flex flex-col items-center gap-6"><h2 className="text-5xl font-cinzel font-black" style={{ color: config.primaryColor }}>CALENDRIER</h2><button onClick={() => setIsEventModalOpen(true)} className="bg-black text-white px-8 py-4 rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform flex items-center gap-3 shadow-xl" style={{ backgroundColor: config.primaryColor }}><Plus size={20}/> Ajouter un événement</button></div>
             <EventModal isOpen={isEventModalOpen} onClose={setIsEventModalOpen} config={config} addEntry={addEntry} newEvent={newEvent} setNewEvent={setNewEvent} />
             <div className="space-y-4">{events.map(ev => { const cleanDate = ev.date.split('T')[0]; const dateObj = new Date(cleanDate); return (<div key={ev.id} className="flex items-center gap-6 p-6 bg-white rounded-2xl shadow-sm border border-black/5 hover:shadow-md transition-shadow group"><div className="text-center w-16"><div className="font-bold text-xl leading-none" style={{color: config.primaryColor}}>{dateObj.getDate()}</div><div className="text-[10px] uppercase font-bold text-gray-400">{dateObj.toLocaleString('fr-FR', { month: 'short' })}</div></div><div className="flex-1 border-l pl-6 border-gray-100"><div className="font-bold text-lg font-cinzel text-gray-800">{ev.title}</div>{ev.time && <div className="text-xs text-gray-400 flex items-center mt-1"><Clock size={10} className="mr-1"/> {ev.time}</div>}</div><button onClick={() => deleteItem('family_events', ev.id)} className="opacity-0 group-hover:opacity-100 p-2 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all" title="Supprimer"><Trash2 size={16} /></button></div>); })}</div>
           </div>
        )}

        {/* --- XSITE WEB --- */}
        {currentView === 'xsite' && (
          <div className="space-y-10">
             {!selectedXSite ? (
                (user.email === ADMIN_EMAIL || favorites.length > 0) ? (
                    <>
                        <div className="flex flex-col items-center gap-6"><h2 className="text-5xl font-cinzel font-black text-center" style={{ color: config.primaryColor }}>MES FAVORIS</h2><p className="text-gray-400 italic">Vos accès rapides XSite</p></div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">{xsitePages.filter(p => user.email === ADMIN_EMAIL ? true : favorites.includes(p.id)).map(site => (<div key={site.id} onClick={() => setSelectedXSite(site)} className="bg-white p-8 rounded-[2rem] shadow-lg border border-gray-100 cursor-pointer hover:scale-105 transition-transform group"><div className="flex items-center justify-between mb-4"><div className="p-3 bg-gray-50 rounded-full group-hover:bg-black group-hover:text-white transition-colors"><Map size={24}/></div><ArrowLeft size={20} className="rotate-180 opacity-0 group-hover:opacity-50"/></div><h3 className="text-xl font-bold uppercase tracking-wide">{site.name}</h3><div className="mt-2 text-xs text-gray-400">Cliquez pour ouvrir</div></div>))}</div>
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 space-y-6 text-center"><div className="p-8 bg-gray-100 rounded-[3rem] animate-pulse"><QrCode size={64} className="text-gray-400"/></div><h2 className="text-3xl font-cinzel font-bold text-gray-400">ACCÈS VERROUILLÉ</h2><p className="text-gray-400 max-w-md">Veuillez scanner un QR code pour accéder à un mini-site.</p></div>
                )
             ) : null}
          </div>
        )}

        {/* --- RECETTES --- */}
        {currentView === 'recipes' && (
          <div className="space-y-10" id="recipes-list">
             <div className="flex flex-col items-center gap-6"><h2 className="text-5xl font-cinzel font-black text-center" style={{ color: config.primaryColor }}>RECETTES</h2><button onClick={() => setIsRecipeModalOpen(true)} className="bg-black text-white px-8 py-4 rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform flex items-center gap-3 shadow-xl" style={{ backgroundColor: config.primaryColor }}><Plus size={20}/> Ajouter une recette</button></div>
             
             {isRecipeModalOpen && (
                <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-2xl rounded-[3rem] p-10 relative max-h-[90vh] overflow-y-auto">
                        <button onClick={() => setIsRecipeModalOpen(false)} className="absolute top-6 right-6 text-gray-400"><X size={24}/></button>
                        <h3 className="text-2xl font-cinzel font-bold mb-8 text-center">Nouvelle Recette</h3>
                        
                        {/* LIEN MAGIQUE IA */}
                        <div className="mb-10 p-6 bg-orange-50 rounded-[2rem] border border-orange-100 flex flex-col gap-4">
                            <label className="text-[10px] font-black uppercase text-orange-400 flex items-center gap-2"><Zap size={14}/> Remplissage Magique par Lien</label>
                            <div className="flex gap-2">
                                <input value={aiLink} onChange={e => setAiLink(e.target.value)} placeholder="Coller une URL de recette (Marmiton...)" className="flex-1 p-3 rounded-xl border-none outline-none text-sm font-bold shadow-inner" />
                                <button onClick={handleAiRecipe} disabled={isAiLoading} className="p-3 bg-orange-500 text-white rounded-xl shadow-lg">{isAiLoading ? <Loader2 className="animate-spin"/> : <Sparkles/>}</button>
                            </div>
                        </div>

                        <input value={currentRecipe.title} onChange={e => setCurrentRecipe({...currentRecipe, title: e.target.value})} className="w-full p-4 rounded-xl bg-gray-50 border-none font-bold mb-4" placeholder="Titre..." />
                        <div className="flex gap-4 mb-4">
                            <input value={currentRecipe.chef} onChange={e => setCurrentRecipe({...currentRecipe, chef: e.target.value})} className="flex-1 p-4 rounded-xl bg-gray-50 border-none outline-none" placeholder="Chef" />
                            <select value={currentRecipe.category} onChange={e => setCurrentRecipe({...currentRecipe, category: e.target.value})} className="flex-1 p-4 rounded-xl bg-gray-50 border-none outline-none"><option value="plat">Plat</option><option value="dessert">Dessert</option><option value="entrée">Entrée</option></select>
                        </div>
                        <textarea value={currentRecipe.ingredients} onChange={e => setCurrentRecipe({...currentRecipe, ingredients: e.target.value})} className="w-full p-4 rounded-xl bg-gray-50 border-none font-bold h-32 mb-4" placeholder="Ingrédients (un par ligne)..." />
                        <textarea value={currentRecipe.steps} onChange={e => setCurrentRecipe({...currentRecipe, steps: e.target.value})} className="w-full p-4 rounded-xl bg-gray-50 border-none font-bold h-32 mb-4" placeholder="Étapes..." />
                        
                        <button onClick={async () => {
                            if(currentRecipe.title) {
                                if (currentRecipe.id) await updateEntry('family_recipes', currentRecipe.id, currentRecipe);
                                else await addEntry('family_recipes', currentRecipe);
                                setIsRecipeModalOpen(false);
                            }
                        }} className="w-full py-4 bg-black text-white rounded-xl font-bold uppercase tracking-widest shadow-xl">Enregistrer</button>
                    </div>
                </div>
             )}

             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {recipes.map((r: any) => (<div key={r.id} className="relative group"><div className="absolute top-4 right-4 z-20 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => addRecipeToHub(r)} className="p-2 bg-white/90 rounded-full shadow-md text-orange-500 hover:scale-110 transition-transform"><ShoppingBag size={16}/></button><button onClick={() => openEditRecipe(r)} className="p-2 bg-white/90 rounded-full shadow-md text-blue-500 hover:scale-110 transition-transform"><Pencil size={16}/></button><button onClick={() => deleteItem('family_recipes', r.id)} className="p-2 bg-white/90 rounded-full shadow-md text-red-500 hover:scale-110 transition-transform"><Trash2 size={16}/></button></div><RecipeCard recipe={{...r, ingredients: typeof r.ingredients === 'string' ? r.ingredients.split('\n') : r.ingredients, instructions: r.steps || r.instructions}} /></div>))}
             </div>
          </div>
        )}

        {currentView === 'cooking' && (
           <div className="bg-white/90 rounded-[3rem] min-h-[800px] shadow-xl overflow-hidden border border-black/5" id="cooking-frame">
             {config.cookingHtml ? <iframe srcDoc={config.cookingHtml} className="w-full min-h-[800px]" /> : <div className="p-20 text-center opacity-40">Semainier non configuré</div>}
           </div>
        )}

        {/* --- ADMINISTRATION --- */}
        {currentView === 'edit' && user.email === ADMIN_EMAIL && (
            <AdminPanel config={config} save={saveConfig} add={addEntry} del={deleteItem} upd={updateEntry} events={events} versions={versions} restore={restoreVersion} recipes={recipes} xsitePages={xsitePages} arch={handleArchitect} chat={handleChat} prompt={aiPrompt} setP={setAiPrompt} load={isAiLoading} hist={chatHistory} users={siteUsers} />
        )}
      </main>
    </div>
  );
};

export default App;
