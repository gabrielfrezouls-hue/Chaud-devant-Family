import React, { useState, useEffect, useRef } from 'react';
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, updateDoc, 
  where, getDoc, arrayUnion, arrayRemove 
} from 'firebase/firestore';
import { 
  Lock, Menu, X, Home, ChefHat, Wallet, PiggyBank,
  Calendar as CalIcon, Settings, Code, Sparkles, Send, History,
  MessageSquare, ChevronRight, LogIn, Loader2, ShieldAlert, RotateCcw, ArrowLeft, Trash2, Pencil,
  CheckSquare, Square, CheckCircle2, Plus, Minus, Clock, Save, ToggleLeft, ToggleRight, Upload, Image as ImageIcon, 
  Map, MonitorPlay, QrCode, Star, Maximize2, Minimize2, Link, Copy, LayoutDashboard, ShoppingCart, StickyNote, Users, ShoppingBag, Bell, Mail, CornerDownRight, Store, CalendarClock, ScanBarcode, Camera, Zap, UtensilsCrossed
} from 'lucide-react';
import { Recipe, FamilyEvent, ViewType, SiteConfig, SiteVersion } from './types';
import { askAIArchitect, askButlerAgent, extractRecipeFromUrl, scanProductImage, readBarcodeFromImage } from './services/geminiService';
import Background from './components/Background';
import RecipeCard from './components/RecipeCard';

// ============================================================================
// 1. CONSTANTES & CONFIGURATION (DÉFINIES EN PREMIER)
// ============================================================================

const ADMIN_EMAIL = "gabriel.frezouls@gmail.com";

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
// 2. LOGIQUE MÉTIER & HELPERS
// ============================================================================

interface AppNotification {
    id: string; message: string; type: 'info' | 'alert' | 'fun'; repeat: 'once' | 'daily' | 'monthly'; targets: string[]; scheduledFor?: string; linkView?: string; linkId?: string; createdAt: string; readBy: Record<string, string>; 
}

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

// API OpenFoodFacts (Appelée après que l'IA a lu le code barre sur la photo)
const fetchProductByBarcode = async (barcode: string) => {
    try {
        const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
        const data = await response.json();
        if (data.status === 1) {
            return {
                name: data.product.product_name_fr || data.product.product_name,
                category: categorizeShoppingItem(data.product.product_name_fr || '')
            };
        }
        return null;
    } catch (e) { return null; }
};

const ROTATION = ['G', 'P', 'V'];
const REF_DATE = new Date('2025-12-20T12:00:00'); 
const getChores = (date: Date) => {
  const saturday = new Date(date); saturday.setDate(date.getDate() - (date.getDay() + 1) % 7); saturday.setHours(12, 0, 0, 0);
  const weekId = `${saturday.getDate()}-${saturday.getMonth()+1}-${saturday.getFullYear()}`;
  const diffTime = saturday.getTime() - REF_DATE.getTime();
  const diffWeeks = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 7));
  const mod = (n: number, m: number) => ((n % m) + m) % m;
  return { id: weekId, fullDate: saturday, dateStr: `${saturday.getDate()}/${saturday.getMonth()+1}`, haut: ROTATION[mod(diffWeeks, 3)], bas: ROTATION[mod(diffWeeks + 2, 3)], douche: ROTATION[mod(diffWeeks + 1, 3)] };
};
const getMonthWeekends = () => {
  const today = new Date(); const year = today.getFullYear(); const month = today.getMonth();
  const weekends = []; const date = new Date(year, month, 1);
  while (date.getDay() !== 6) { date.setDate(date.getDate() + 1); }
  while (date.getMonth() === month) { weekends.push(getChores(new Date(date))); date.setDate(date.getDate() + 7); }
  return weekends;
};

// ============================================================================
// 3. COMPOSANTS UI
// ============================================================================

const HomeCard = ({ icon, title, label, onClick, color }: any) => (
  <div onClick={onClick} className="bg-white/70 backdrop-blur-md p-8 rounded-[2.5rem] cursor-pointer hover:scale-105 transition-transform shadow-lg border border-white/50 group flex flex-col justify-between h-48">
    <div style={{ color }} className="mb-4 group-hover:scale-110 transition-transform">{icon}</div>
    <div><h3 className="text-xl font-cinzel font-bold mb-1 uppercase">{title}</h3><p className="text-[10px] font-bold tracking-widest opacity-50 uppercase flex items-center gap-1">{label} <ChevronRight size={12}/></p></div>
  </div>
);

const TaskCell = ({ weekId, letter, label, isLocked, choreStatus, toggleChore, myLetter }: any) => {
  const isDone = choreStatus[weekId]?.[letter] || false; const canCheck = !isLocked && myLetter === letter; 
  return (<td className="p-4 text-center align-middle"><div className="flex flex-col items-center gap-2"><span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-sm ${isDone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}> {letter} </span><button onClick={() => canCheck && toggleChore(weekId, letter)} disabled={!canCheck} className={`transition-transform active:scale-95 ${!canCheck && !isDone ? 'opacity-20 cursor-not-allowed' : ''}`} title={isLocked ? "Trop tôt pour cocher !" : ""}>{isDone ? <CheckSquare className="text-green-500" size={24} /> : (canCheck ? <Square className="text-green-500 hover:fill-green-50" size={24} /> : <Square className="text-gray-200" size={24} />)}</button></div></td>);
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
                    <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-3xl"><span className="font-cinzel font-bold text-xs">Le Majordome</span><button onClick={() => setIsOpen(false)}><X size={16}/></button></div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">{chatHistory.map((c:any, i:number) => (<div key={i} className={`p-3 rounded-2xl text-xs ${c.role === 'user' ? 'bg-orange-100 ml-8' : 'bg-gray-100 mr-8'}`}>{c.text}</div>))}{isAiLoading && <Loader2 className="animate-spin text-gray-300 mx-auto"/>}</div>
                    <div className="p-3 border-t flex gap-2"><input value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChat()} placeholder="Ajouter du lait, une idée repas..." className="flex-1 text-xs p-2 rounded-xl bg-gray-50 outline-none" /><button onClick={handleChat} className="p-2 bg-black text-white rounded-xl"><Send size={14}/></button></div>
                </div>
            )}
            <button onClick={() => setIsOpen(!isOpen)} className="w-14 h-14 bg-black text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-110 transition-transform">{isOpen ? <X/> : <Sparkles size={24} className="animate-pulse text-orange-400"/>}</button>
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
        const storeA = a.store || 'Z'; const storeB = b.store || 'Z';
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
                    <div className="flex gap-2"><input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()} placeholder={inputType === 'shop' ? "Ex: Lait, Beurre..." : "Message..."} className="flex-1 p-4 rounded-2xl bg-gray-50 font-bold outline-none border-2 border-transparent focus:border-black transition-colors"/><button onClick={addItem} className="p-4 bg-black text-white rounded-2xl hover:scale-105 transition-transform"><Plus/></button></div>
                    {inputType === 'shop' && (
                        <div className="relative">
                            <div className="flex items-center bg-gray-50 rounded-xl px-4 border border-gray-200"><Store size={16} className="text-gray-400 mr-2"/><input value={storeSearch} onFocus={() => setShowStoreList(true)} onChange={e => { setStoreSearch(e.target.value); setSelectedStore(e.target.value); }} placeholder="Rechercher un magasin..." className="w-full py-3 bg-transparent text-xs font-bold outline-none text-gray-600"/></div>
                            {showStoreList && storeSearch && (
                                <div className="absolute top-full left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto z-50">
                                    {filteredStores.map(store => (<div key={store} onClick={() => { setSelectedStore(store); setStoreSearch(store); setShowStoreList(false); }} className="p-3 text-xs font-bold hover:bg-gray-50 cursor-pointer border-b border-gray-50">{store}</div>))}
                                    <div onClick={() => { setSelectedStore(storeSearch); setShowStoreList(false); }} className="p-3 bg-orange-50 text-orange-600 text-xs font-bold hover:bg-orange-100 cursor-pointer flex items-center justify-between"><span>Ajouter "{storeSearch}"</span><Plus size={14}/></div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-4" id="hub-shop"><h3 className="font-cinzel font-bold text-xl text-gray-400 flex items-center gap-2"><ShoppingCart size={20}/> LISTE DE COURSES</h3>{sortedShopItems.map(item => (<div key={item.id} className="group flex justify-between items-center p-4 bg-white rounded-2xl shadow-sm border-l-4 border-orange-400 hover:shadow-md transition-all"><div><div className="flex items-center gap-2 mb-1"><span className="text-[9px] font-black uppercase text-orange-600 bg-orange-100 px-2 py-0.5 rounded-md">{item.category}</span>{item.store && <span className="text-[9px] font-bold uppercase text-gray-400 bg-gray-100 px-2 py-0.5 rounded-md"><Store size={8} className="inline mr-1"/>{item.store}</span>}</div><span className="font-bold text-gray-700 block">{item.content}</span></div><button onClick={() => deleteItem(item.id)} className="text-gray-300 hover:text-red-500"><X size={18}/></button></div>))}{sortedShopItems.length === 0 && <div className="text-center p-8 border-2 border-dashed border-gray-200 rounded-2xl text-gray-300">Frigo plein !</div>}</div>
                <div className="space-y-4" id="hub-notes"><h3 className="font-cinzel font-bold text-xl text-gray-400 flex items-center gap-2"><StickyNote size={20}/> PENSE-BÊTES</h3><div className="grid grid-cols-2 gap-2">{hubItems.filter(i => i.type === 'note').map(item => (<div key={item.id} className="relative p-4 bg-yellow-50 rounded-xl shadow-sm border border-yellow-100 rotate-1 hover:rotate-0 transition-transform"><button onClick={() => deleteItem(item.id)} className="absolute top-2 right-2 text-yellow-300 hover:text-red-500"><X size={14}/></button><p className="font-handwriting font-bold text-yellow-900 text-sm">{item.content}</p><div className="mt-2 text-[10px] text-yellow-600 font-bold uppercase text-right">- {item.author}</div></div>))}</div></div>
                <div className="space-y-4" id="hub-msg"><h3 className="font-cinzel font-bold text-xl text-gray-400 flex items-center gap-2"><MessageSquare size={20}/> LE MUR</h3>{hubItems.filter(i => i.type === 'msg').map(item => (<div key={item.id} className="p-6 bg-blue-500 text-white rounded-tr-3xl rounded-bl-3xl rounded-tl-xl rounded-br-xl shadow-lg relative group"><button onClick={() => deleteItem(item.id)} className="absolute top-2 right-2 text-blue-300 hover:text-white"><X size={14}/></button><p className="font-bold text-lg leading-tight">"{item.content}"</p><p className="mt-4 text-xs opacity-60 uppercase tracking-widest text-right">Posté par {item.author}</p></div>))}</div>
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

    // SCAN PRODUIT VIA IA (PHOTO)
    const handlePhotoScan = async (e: any) => {
        const file = e.target.files[0]; if (!file) return;
        setIsScanning(true);
        const result = await scanProductImage(file); 
        if (result) await addDoc(collection(db, 'fridge_items'), { name: result.name, category: categorizeShoppingItem(result.name), addedAt: new Date().toISOString(), expiryDate: result.expiryDate });
        setIsScanning(false);
    };

    // SCAN CODE BARRE VIA IA (PHOTO -> GEMINI -> API)
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
                     expiryDate: new Date(Date.now() + 7*86400000).toISOString().split('T')[0] // Date par défaut J+7 si code barre
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
                            <div><span className="text-[9px] font-black uppercase text-green-600 bg-green-50 px-2 py-1 rounded-md">{item.category}</span><h4 className="font-bold text-lg mt-1">{item.name}</h4><p className={`text-xs font-bold flex items-center gap-1 mt-1 ${daysLeft < 3 ? 'text-red-500' : 'text-green-500'}`}><Clock size={12}/> {daysLeft < 0 ? 'PÉRIMÉ' : (daysLeft === 0 ? "AUJOURD'HUI" : `J-${daysLeft}`)}</p></div>
                            <button onClick={() => deleteDoc(doc(db, 'fridge_items', item.id))} className="text-gray-300 group-hover:text-red-400"><Trash2/></button>
                        </div>
                    );
                })}
            </div>
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
  
  // Utiliser une hauteur fixe et un overflow pour éviter que l'admin ne casse la page
  return (
    <div className="bg-white/90 backdrop-blur-xl rounded-[2.5rem] shadow-2xl h-[80vh] border border-black/5 flex flex-col md:flex-row overflow-hidden">
        
        {/* SIDEBAR GAUCHE (Menu) */}
        <nav className="w-full md:w-64 bg-gray-50/50 p-6 flex flex-col gap-6 border-r border-gray-100 overflow-y-auto shrink-0">
            <div>
                <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-3">Famille</h4>
                <div className="space-y-1">
                    <button onClick={() => setTab('users')} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-3 ${tab==='users' ? 'bg-black text-white shadow-lg' : 'hover:bg-white text-gray-600'}`}><Users size={16}/> Utilisateurs</button>
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
                    <button onClick={() => setTab('arch')} className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-3 ${tab==='arch' ? 'bg-black text-white shadow-lg' : 'hover:bg-white text-gray-600'}`}><Sparkles size={16}/> Architecte IA</button>
                </div>
            </div>
        </nav>

        {/* CONTENU DROITE (Scrollable) */}
        <main className="flex-1 p-8 overflow-y-auto bg-white/50">
            {tab === 'users' && (
                <div className="space-y-8 animate-in fade-in">
                    <h3 className="text-3xl font-cinzel font-bold text-gray-800">GESTION UTILISATEURS</h3>
                    <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100">
                        <div className="flex flex-col md:flex-row gap-4">
                            <input value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} placeholder="Email" className="flex-1 p-3 rounded-xl border-none shadow-sm" />
                            <input value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} placeholder="Prénom" className="w-32 p-3 rounded-xl border-none shadow-sm" />
                            <input value={newUser.letter} onChange={e => setNewUser({...newUser, letter: e.target.value})} placeholder="Lettre" className="w-20 p-3 rounded-xl border-none shadow-sm text-center" />
                            <button onClick={registerUser} className="bg-black text-white p-3 rounded-xl"><Plus/></button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        {users.map((u:any) => (
                            <div key={u.id} className="flex justify-between items-center p-4 bg-white rounded-2xl border border-gray-100">
                                <div><span className="font-bold">{u.name}</span> <span className="text-xs text-gray-400">({u.email})</span></div>
                                <span className="text-xs font-bold bg-green-50 text-green-600 px-2 py-1 rounded">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : '-'}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {tab === 'home' && (
                <div className="space-y-6 animate-in fade-in">
                    <h3 className="text-3xl font-cinzel font-bold text-gray-800">ACCUEIL</h3>
                    <input value={localC.welcomeTitle} onChange={e => setLocalC({...localC, welcomeTitle: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200" placeholder="Titre" />
                    <textarea value={localC.welcomeText} onChange={e => setLocalC({...localC, welcomeText: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 h-24" placeholder="Texte" />
                    <button onClick={() => save(localC, true)} className="w-full py-4 bg-black text-white rounded-xl font-bold uppercase shadow-lg">Sauvegarder</button>
                </div>
            )}

             {tab === 'arch' && (
                <div className="space-y-6 animate-in fade-in">
                   <h3 className="text-3xl font-cinzel font-bold text-gray-800">ARCHITECTE IA</h3>
                   <textarea value={prompt} onChange={e => setP(e.target.value)} className="w-full p-6 rounded-3xl border border-gray-200 h-32 focus:ring-4 outline-none" placeholder="Ex: 'Met un thème sombre et doré'..." />
                   <button onClick={arch} disabled={load} className="w-full py-5 text-white rounded-2xl font-black uppercase shadow-xl bg-indigo-600">{load ? <Loader2 className="animate-spin mx-auto"/> : "Transformer le design"}</button>
                </div>
            )}
        </main>
    </div>
  );
};

// ============================================================================
// 6. APP COMPONENT PRINCIPAL
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
