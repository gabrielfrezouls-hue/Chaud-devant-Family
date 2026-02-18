import React, { useState, useEffect, useRef } from 'react';
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, updateDoc, 
  where, getDoc, arrayUnion, arrayRemove 
} from 'firebase/firestore';
import { 
  Menu, X, Home, ChefHat, Wallet, PiggyBank,
  Calendar as CalIcon, Settings, Code, Sparkles, Send, History,
  MessageSquare, ChevronRight, LogIn, Loader2, ShieldAlert, RotateCcw, ArrowLeft, Trash2, Pencil,
  CheckSquare, Square, CheckCircle2, Plus, Minus, Clock, Save, Image as ImageIcon, 
  Map, QrCode, Star, Maximize2, Minimize2, Link, Copy, LayoutDashboard, ShoppingCart, StickyNote, Users, ShoppingBag, Bell, Mail, CornerDownRight, Store, CalendarClock, ScanBarcode, Camera, Zap, UtensilsCrossed, LogOut, ExternalLink, RefreshCw
} from 'lucide-react';
import { Recipe, FamilyEvent, ViewType, SiteConfig, SiteVersion } from './types';
import { askAIArchitect, askAIChat, extractRecipeFromUrl, scanProductImage, askButlerAgent, readBarcodeFromImage } from './services/geminiService';
import Background from './components/Background';
import RecipeCard from './components/RecipeCard';

// ============================================================================
// 1. CONSTANTES & CONFIGURATION (DÉFINIES EN PREMIER)
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
// 2. LOGIQUE MÉTIER & HELPERS
// ============================================================================

interface AppNotification {
    id: string; message: string; type: 'info' | 'alert' | 'fun'; repeat: 'once' | 'daily' | 'monthly'; targets: string[]; scheduledFor?: string; linkView?: string; linkId?: string; createdAt: string; readBy: Record<string, string>; 
}

const categorizeShoppingItem = (text: string) => {
    const lower = text.toLowerCase();
    if (/(lait|beurre|yaourt|creme|oeuf|fromage)/.test(lower)) return 'Frais';
    if (/(pomme|banane|legume|fruit|salade|tomate)/.test(lower)) return 'Primeur';
    if (/(viande|poulet|poisson|jambon|steak)/.test(lower)) return 'Boucherie';
    if (/(pates|riz|conserve|huile|epice|sucre|farine)/.test(lower)) return 'Épicerie';
    if (/(coca|jus|vin|biere|eau|sirop)/.test(lower)) return 'Boissons';
    if (/(shampoing|savon|dentifrice|lessive|papier)/.test(lower)) return 'Hygiène/Maison';
    if (/(chat|chien|croquette)/.test(lower)) return 'Animaux';
    return 'Divers';
};

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

// --- LOGIQUE TÂCHES MÉNAGÈRES ---
const ROTATION = ['G', 'P', 'V']; // Gabriel, Pauline, Valentin
const REF_DATE = new Date('2025-12-20T12:00:00'); 

const getChores = (date: Date) => {
  const saturday = new Date(date);
  saturday.setDate(date.getDate() - (date.getDay() + 1) % 7);
  saturday.setHours(12, 0, 0, 0);
  
  const weekId = `${saturday.getDate()}-${saturday.getMonth()+1}-${saturday.getFullYear()}`;
  
  // Calcul de la différence en semaines
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
  
  // Trouver le premier samedi
  while (date.getDay() !== 6) { date.setDate(date.getDate() + 1); }
  
  // Ajouter tous les samedis du mois
  while (date.getMonth() === month) {
    weekends.push(getChores(new Date(date)));
    date.setDate(date.getDate() + 7);
  }
  return weekends;
};

// ============================================================================
// 3. COMPOSANTS UI (DÉFINIS AVANT UTILISATION)
// ============================================================================

const HomeCard = ({ icon, title, label, onClick, color }: any) => (
  <div onClick={onClick} className="bg-white/70 backdrop-blur-md p-8 rounded-[2.5rem] cursor-pointer hover:scale-105 transition-transform shadow-lg border border-white/50 group flex flex-col justify-between h-48">
    <div style={{ color }} className="mb-4 group-hover:scale-110 transition-transform">{icon}</div>
    <div><h3 className="text-xl font-cinzel font-bold mb-1 uppercase">{title}</h3><p className="text-[10px] font-bold tracking-widest opacity-50 uppercase flex items-center gap-1">{label} <ChevronRight size={12}/></p></div>
  </div>
);

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

const ButlerFloating = ({ chatHistory, setChatHistory, isAiLoading, setIsAiLoading, onAction }: any) => {
    const [isOpen, setIsOpen] = useState(false);
    const [msg, setMsg] = useState('');
    const handleChat = async () => {
        if (!msg.trim()) return;
        const h = [...chatHistory, { role: 'user', text: msg }];
        setChatHistory(h); setMsg(''); setIsAiLoading(true);
        const response = await askButlerAgent(h, {});
        if (response.type === 'action') {
            if (response.data.action === 'ADD_HUB') onAction('shop', response.data.item);
            setChatHistory([...h, { role: 'model', text: response.data.reply || "C'est fait !" }]);
        } else {
            setChatHistory([...h, { role: 'model', text: response.data }]);
        }
        setIsAiLoading(false);
    };
    return (
        <div className="fixed bottom-24 right-6 z-[200] flex flex-col items-end">
            {isOpen && (<div className="w-80 h-96 bg-white rounded-3xl shadow-2xl border border-gray-100 flex flex-col mb-4 animate-in slide-in-from-bottom-5"><div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-3xl"><span className="font-cinzel font-bold text-xs">Le Majordome</span><button onClick={() => setIsOpen(false)}><X size={16}/></button></div><div className="flex-1 overflow-y-auto p-4 space-y-3">{chatHistory.map((c:any, i:number) => (<div key={i} className={`p-3 rounded-2xl text-xs ${c.role === 'user' ? 'bg-orange-100 ml-8' : 'bg-gray-100 mr-8'}`}>{c.text}</div>))}{isAiLoading && <Loader2 className="animate-spin text-gray-300 mx-auto"/>}</div><div className="p-3 border-t flex gap-2"><input value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChat()} placeholder="Ajoute du lait..." className="flex-1 text-xs p-2 rounded-xl bg-gray-50 outline-none" /><button onClick={handleChat} className="p-2 bg-black text-white rounded-xl"><Send size={14}/></button></div></div>)}
            <button onClick={() => setIsOpen(!isOpen)} className="w-14 h-14 bg-black text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-110 transition-transform">{isOpen ? <X/> : <Sparkles size={24} className="animate-pulse text-orange-400"/>}</button>
        </div>
    );
};

// ============================================================================
// 4. VUES (Hub, Frigo, Wallet, Tâches, Recettes, etc.)
// ============================================================================

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
                <div className="flex gap-2 mb-4"><button onClick={() => setType('shop')} className={`flex-1 py-2 rounded-xl text-xs font-bold ${type==='shop'?'bg-orange-500 text-white':'bg-gray-100'}`}>Course</button><button onClick={() => setType('note')} className={`flex-1 py-2 rounded-xl text-xs font-bold ${type==='note'?'bg-yellow-400 text-white':'bg-gray-100'}`}>Note</button><button onClick={() => setType('msg')} className={`flex-1 py-2 rounded-xl text-xs font-bold ${type==='msg'?'bg-blue-500 text-white':'bg-gray-100'}`}>Msg</button></div>
                <div className="flex gap-2"><input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Ajouter..." className="flex-1 p-3 rounded-xl bg-gray-50 outline-none"/><button onClick={add} className="p-3 bg-black text-white rounded-xl"><Plus/></button></div>
                {type === 'shop' && <div className="relative mt-2"><input value={store} onFocus={() => setShowStore(true)} onChange={e => setStore(e.target.value)} placeholder="Magasin..." className="w-full p-2 bg-gray-50 rounded-xl text-xs outline-none"/><div className={`absolute top-full left-0 right-0 bg-white shadow-lg rounded-xl max-h-32 overflow-y-auto z-10 ${!showStore && 'hidden'}`}>{filteredStores.map(s => <div key={s} onClick={() => { setStore(s); setShowStore(false); }} className="p-2 text-xs hover:bg-gray-50">{s}</div>)}</div></div>}
             </div>
             <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                 {items.map(i => (
                     <div key={i.id} className={`p-4 rounded-2xl shadow-sm border-l-4 flex justify-between items-center ${i.type==='shop'?'border-orange-400 bg-white':i.type==='note'?'border-yellow-400 bg-yellow-50':'border-blue-500 bg-blue-50'}`}>
                         <div>{i.type==='shop' && <span className="text-[9px] font-black uppercase text-gray-400 mr-2">{i.store}</span>}<span className="font-bold">{i.content}</span></div>
                         <button onClick={() => deleteDoc(doc(db, 'hub_items', i.id))}><X size={16} className="text-gray-300"/></button>
                     </div>
                 ))}
             </div>
        </div>
    );
};

const FridgeView = () => {
    const [items, setItems] = useState<any[]>([]);
    const [scanning, setScanning] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const barcodeRef = useRef<HTMLInputElement>(null);
    const [manualEntry, setManualEntry] = useState({ name: '', expiry: '' });
    
    useEffect(() => { const u = onSnapshot(query(collection(db, 'fridge_items'), orderBy('expiryDate')), (s) => setItems(s.docs.map(d => ({id:d.id, ...d.data()})))); return () => u(); }, []);

    // GESTION SCAN & IA
    const handleScan = async (e: any, mode: 'product' | 'barcode') => {
        const f = e.target.files[0]; 
        e.target.value = null; // Reset
        if(!f) return;

        setScanning(true);
        let res: any = null;

        if (mode === 'barcode') {
            const code = await readBarcodeFromImage(f);
            if(code) {
                res = await fetchProductByBarcode(code);
                if(res) {
                    res.expiryDate = new Date(Date.now() + 604800000).toISOString().split('T')[0]; 
                    alert(`Produit trouvé : ${res.name}`);
                } else {
                    alert(`Code ${code} lu, mais produit inconnu.`);
                }
            } else {
                alert("Code barre illisible sur la photo. Essayez de bien cadrer et d'avoir de la lumière.");
            }
        } else {
            res = await scanProductImage(f);
        }

        if(res) await addDoc(collection(db, 'fridge_items'), { ...res, addedAt: new Date().toISOString() });
        setScanning(false);
    };

    return (
        <div className="space-y-6 animate-in fade-in pb-24">
            <div className="grid grid-cols-2 gap-4">
                <button onClick={() => barcodeRef.current?.click()} className="p-6 bg-white rounded-3xl shadow-lg border border-gray-100 flex flex-col items-center gap-2">{scanning ? <Loader2 className="animate-spin"/> : <ScanBarcode size={32}/>}<span className="text-xs font-bold">Code Barre (Photo)</span></button>
                <button onClick={() => fileRef.current?.click()} className="p-6 bg-white rounded-3xl shadow-lg border border-gray-100 flex flex-col items-center gap-2">{scanning ? <Loader2 className="animate-spin text-orange-500"/> : <Camera size={32} className="text-orange-500"/>}<span className="text-xs font-bold">Produit (IA)</span></button>
                <input type="file" ref={barcodeRef} accept="image/*" capture="environment" className="hidden" onChange={e => handleScan(e, 'barcode')} />
                <input type="file" ref={fileRef} accept="image/*" capture="environment" className="hidden" onChange={e => handleScan(e, 'product')} />
            </div>

            <div className="bg-white p-6 rounded-3xl shadow-sm">
                <h3 className="font-bold text-xs uppercase tracking-widest text-gray-400 mb-4">Ajout Manuel</h3>
                <div className="flex gap-2">
                    <input value={manualEntry.name} onChange={e => setManualEntry({...manualEntry, name: e.target.value})} placeholder="Produit..." className="flex-1 p-3 bg-gray-50 rounded-xl font-bold text-sm outline-none"/>
                    <input type="date" value={manualEntry.expiry} onChange={e => setManualEntry({...manualEntry, expiry: e.target.value})} className="p-3 bg-gray-50 rounded-xl font-bold text-sm outline-none"/>
                    <button onClick={async () => { if(manualEntry.name) { await addDoc(collection(db, 'fridge_items'), { name: manualEntry.name, category: categorizeShoppingItem(manualEntry.name), addedAt: new Date().toISOString(), expiryDate: manualEntry.expiry || new Date().toISOString().split('T')[0] }); setManualEntry({name:'', expiry:''}); }}} className="p-3 bg-black text-white rounded-xl"><Plus/></button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {items.map(i => {
                    const diff = Math.ceil((new Date(i.expiryDate).getTime() - new Date().getTime()) / 86400000);
                    return (<div key={i.id} className="p-4 bg-white rounded-2xl shadow-sm flex justify-between items-center"><div><div className="text-xs font-bold text-gray-400 uppercase">{i.category}</div><div className="font-bold">{i.name}</div><div className={`text-xs ${diff<3?'text-red-500':'text-green-500'}`}>{diff<0?'Périmé':`J-${diff}`}</div></div><button onClick={() => deleteDoc(doc(db, 'fridge_items', i.id))}><Trash2 size={18} className="text-gray-300"/></button></div>);
                })}
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
  const [newTask, setNewTask] = useState('');
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

  const addDebt = async () => { if (!newDebt.from || !newDebt.amount) return; await addDoc(collection(db, 'family_debts'), { ...newDebt, amount: parseFloat(newDebt.amount), interest: parseFloat(newDebt.interest || '0'), createdAt: new Date().toISOString() }); setNewDebt({ from: '', to: '', amount: '', interest: '0' }); };
  const updateBalance = async (type: 'add' | 'sub') => { const val = parseFloat(walletAmount); if (!val) return; const newBal = type === 'add' ? myWallet.balance + val : myWallet.balance - val; await updateDoc(doc(db, 'user_wallets', user.email!), { balance: newBal, history: [...(myWallet.history || []), { date: new Date().toISOString(), amount: type === 'add' ? val : -val, newBalance: newBal }] }); setWalletAmount(''); };
  const saveGoal = async () => { const v = parseFloat(goalInput); if(!isNaN(v)) await updateDoc(doc(db, 'user_wallets', user.email!), { savingsGoal: v, startBalance: myWallet.balance }); };
  
  let fillPercent = 0; if (myWallet && (myWallet.savingsGoal - myWallet.startBalance) > 0) { fillPercent = ((myWallet.balance - myWallet.startBalance) / (myWallet.savingsGoal - myWallet.startBalance)) * 100; }

  return (
    <div className="space-y-6 pb-20 animate-in fade-in" id="top">
      <div className="flex justify-center gap-4 mb-8"><button onClick={() => setActiveTab('family')} className={`px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${activeTab === 'family' ? 'bg-black text-white shadow-lg' : 'bg-white text-gray-400'}`}><ShieldAlert className="inline mr-2 mb-1" size={16}/> Dettes</button><button onClick={() => setActiveTab('personal')} className={`px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${activeTab === 'personal' ? 'bg-black text-white shadow-lg' : 'bg-white text-gray-400'}`}><PiggyBank className="inline mr-2 mb-1" size={16}/> Tirelire</button></div>
      {activeTab === 'family' ? (
        <div className="bg-white/80 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-xl border border-white space-y-8" id="wallet-debts">
           <div className="flex gap-2 items-end"><input value={newDebt.from} onChange={e => setNewDebt({...newDebt, from: e.target.value})} placeholder="Qui doit ?" className="p-3 rounded-xl bg-white w-24" /><input value={newDebt.to} onChange={e => setNewDebt({...newDebt, to: e.target.value})} placeholder="À qui ?" className="p-3 rounded-xl bg-white w-24" /><input type="number" value={newDebt.amount} onChange={e => setNewDebt({...newDebt, amount: e.target.value})} placeholder="€" className="p-3 rounded-xl bg-white w-20" /><button onClick={addDebt} className="p-3 bg-black text-white rounded-xl"><Plus/></button></div>
           <div className="space-y-2">{debts.map(d => (<div key={d.id} className="flex justify-between p-4 bg-white rounded-2xl border border-gray-100"><span className="font-bold">{d.from} doit {calculateDebt(d)}€ à {d.to}</span><button onClick={() => deleteDoc(doc(db, 'family_debts', d.id))}><Trash2 size={16} className="text-red-400"/></button></div>))}</div>
        </div>
      ) : (
        <div className="bg-white/80 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-xl border border-white space-y-8">
             <div className="relative h-48 w-full"><CircleLiquid fillPercentage={fillPercent} /><div className="absolute inset-0 flex flex-col items-center justify-center"><h2 className="text-4xl font-black text-yellow-900">{myWallet?.balance?.toFixed(0)}€</h2></div></div>
             <div className="flex gap-2 justify-center"><button onClick={() => updateBalance('sub')} className="p-3 bg-red-100 text-red-600 rounded-xl"><Minus/></button><input type="number" value={walletAmount} onChange={e => setWalletAmount(e.target.value)} className="w-24 text-center bg-white rounded-xl" /><button onClick={() => updateBalance('add')} className="p-3 bg-green-100 text-green-600 rounded-xl"><Plus/></button></div>
             <div className="flex gap-2 items-center"><Target size={16}/><input type="number" value={goalInput} onChange={e => setGoalInput(e.target.value)} onBlur={saveGoal} placeholder="Objectif..." className="w-full bg-transparent font-bold"/></div>
        </div>
      )}
    </div>
  );
};

const TasksView = ({ choreStatus, toggleChore, myLetter }: any) => {
    return (
        <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-8" id="tasks-table">
            <div className="text-center space-y-4"><h2 className="text-5xl font-cinzel font-black">TÂCHES</h2><p className="text-gray-500 font-serif italic">{myLetter ? `Salut ${myLetter === 'G' ? 'Gabriel' : myLetter === 'P' ? 'Pauline' : 'Valentin'}` : "Connecte-toi"}</p></div>
            <div className="bg-white/90 backdrop-blur-xl rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/50">
              <div className="overflow-x-auto">
                  <table className="w-full">
                      <thead>
                          <tr className="text-left bg-gray-100/50">
                              <th className="p-4 font-black uppercase text-xs tracking-widest text-gray-500">Weekend</th>
                              <th className="p-4 font-black uppercase text-xs tracking-widest text-center">Haut</th>
                              <th className="p-4 font-black uppercase text-xs tracking-widest text-center">Bas</th>
                              <th className="p-4 font-black uppercase text-xs tracking-widest text-center">Douche</th>
                              <th className="p-4 w-10"></th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                          {getMonthWeekends().map((week, i) => { 
                              const rowStatus = choreStatus[week.id] || {}; 
                              const isRowComplete = rowStatus.G && rowStatus.P && rowStatus.V; 
                              const now = new Date(); 
                              const isLocked = week.fullDate.getTime() > (now.getTime() + 86400000 * 6); 
                              return (
                                  <tr key={i} className={`transition-colors ${isRowComplete ? 'bg-green-50/50' : 'hover:bg-white/50'}`}>
                                      <td className="p-4 font-mono font-bold text-gray-700 whitespace-nowrap text-sm">{week.dateStr}{isLocked && <span className="ml-2 text-xs text-gray-300">🔒</span>}</td>
                                      <TaskCell weekId={week.id} letter={week.haut} label="Aspi Haut" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter} />
                                      <TaskCell weekId={week.id} letter={week.bas} label="Aspi Bas" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter} />
                                      <TaskCell weekId={week.id} letter={week.douche} label="Lavabo" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter} />
                                      <td className="p-4 text-center">{isRowComplete && <CheckCircle2 className="text-green-500 mx-auto animate-bounce" />}</td>
                                  </tr>
                              ); 
                          })}
                      </tbody>
                  </table>
              </div>
            </div>
        </div>
    );
};

const RecipesView = ({ recipes, addRecipeToHub, openEditRecipe, deleteItem, setIsRecipeModalOpen, isRecipeModalOpen, currentRecipe, setCurrentRecipe, updateEntry, addEntry, handleAiRecipe, aiLink, setAiLink, isAiLoading }: any) => {
    return (
        <div className="space-y-10" id="recipes-list">
             <div className="flex flex-col items-center gap-6"><h2 className="text-5xl font-cinzel font-black text-center">RECETTES</h2><button onClick={() => setIsRecipeModalOpen(true)} className="bg-black text-white px-8 py-4 rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform flex items-center gap-3 shadow-xl"><Plus size={20}/> Ajouter</button></div>
             
             {isRecipeModalOpen && (
                <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-2xl rounded-[3rem] p-10 relative max-h-[90vh] overflow-y-auto">
                        <button onClick={() => setIsRecipeModalOpen(false)} className="absolute top-6 right-6 text-gray-400"><X size={24}/></button>
                        <h3 className="text-2xl font-cinzel font-bold mb-8 text-center">Nouvelle Recette</h3>
                        <div className="mb-10 p-6 bg-orange-50 rounded-[2rem] border border-orange-100 flex flex-col gap-4">
                            <label className="text-[10px] font-black uppercase text-orange-400 flex items-center gap-2"><Zap size={14}/> Remplissage Magique par Lien</label>
                            <div className="flex gap-2"><input value={aiLink} onChange={e => setAiLink(e.target.value)} placeholder="URL recette..." className="flex-1 p-3 rounded-xl border-none outline-none text-sm font-bold shadow-inner" /><button onClick={handleAiRecipe} disabled={isAiLoading} className="p-3 bg-orange-500 text-white rounded-xl shadow-lg">{isAiLoading ? <Loader2 className="animate-spin"/> : <Sparkles/>}</button></div>
                        </div>
                        <input value={currentRecipe.title} onChange={e => setCurrentRecipe({...currentRecipe, title: e.target.value})} className="w-full p-4 rounded-xl bg-gray-50 border-none font-bold mb-4" placeholder="Titre..." />
                        <div className="flex gap-4 mb-4"><input value={currentRecipe.chef} onChange={e => setCurrentRecipe({...currentRecipe, chef: e.target.value})} className="flex-1 p-4 rounded-xl bg-gray-50 border-none outline-none" placeholder="Chef" /><select value={currentRecipe.category} onChange={e => setCurrentRecipe({...currentRecipe, category: e.target.value})} className="flex-1 p-4 rounded-xl bg-gray-50 border-none outline-none"><option value="plat">Plat</option><option value="dessert">Dessert</option><option value="entrée">Entrée</option></select></div>
                        <textarea value={currentRecipe.ingredients} onChange={e => setCurrentRecipe({...currentRecipe, ingredients: e.target.value})} className="w-full p-4 rounded-xl bg-gray-50 border-none font-bold h-32 mb-4" placeholder="Ingrédients..." /><textarea value={currentRecipe.steps} onChange={e => setCurrentRecipe({...currentRecipe, steps: e.target.value})} className="w-full p-4 rounded-xl bg-gray-50 border-none font-bold h-32 mb-4" placeholder="Étapes..." />
                        <button onClick={async () => { if(currentRecipe.title) { if (currentRecipe.id) await updateEntry('family_recipes', currentRecipe.id, currentRecipe); else await addEntry('family_recipes', currentRecipe); setIsRecipeModalOpen(false); }}} className="w-full py-4 bg-black text-white rounded-xl font-bold uppercase tracking-widest shadow-xl">Enregistrer</button>
                    </div>
                </div>
             )}

             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {recipes.map((r: any) => (<div key={r.id} className="relative group"><div className="absolute top-4 right-4 z-20 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => addRecipeToHub(r)} className="p-2 bg-white/90 rounded-full shadow-md text-orange-500 hover:scale-110 transition-transform"><ShoppingBag size={16}/></button><button onClick={() => openEditRecipe(r)} className="p-2 bg-white/90 rounded-full shadow-md text-blue-500 hover:scale-110 transition-transform"><Pencil size={16}/></button><button onClick={() => deleteItem('family_recipes', r.id)} className="p-2 bg-white/90 rounded-full shadow-md text-red-500 hover:scale-110 transition-transform"><Trash2 size={16}/></button></div><RecipeCard recipe={{...r, ingredients: typeof r.ingredients === 'string' ? r.ingredients.split('\n') : r.ingredients, instructions: r.steps || r.instructions}} /></div>))}
             </div>
        </div>
    );
};

// ============================================================================
// 5. ADMIN PANEL (CORRIGÉ & STRUCTURÉ)
// ============================================================================

const AdminPanel = ({ config, save, users, notifications, xsitePages }: any) => {
  const [tab, setTab] = useState('users');
  const [notif, setNotif] = useState({ message: '', targets: ['all'], type: 'info' });
  const [newUser, setNewUser] = useState({ email: '', letter: '', name: '' });
  const [localC, setLocalC] = useState(config);
  
  return (
    <div className="bg-white/90 backdrop-blur-xl rounded-[2.5rem] shadow-2xl h-[70vh] border border-black/5 flex flex-col md:flex-row overflow-hidden">
        {/* SIDEBAR ADMIN FIXE */}
        <nav className="w-full md:w-64 bg-gray-50 p-6 flex flex-col gap-4 overflow-y-auto shrink-0 border-r border-gray-100">
            <h4 className="text-xs font-black uppercase text-gray-400">Menu</h4>
            <button onClick={() => setTab('users')} className={`p-3 rounded-xl text-xs font-bold text-left ${tab==='users'?'bg-black text-white':'hover:bg-white'}`}>Utilisateurs</button>
            <button onClick={() => setTab('notif')} className={`p-3 rounded-xl text-xs font-bold text-left ${tab==='notif'?'bg-black text-white':'hover:bg-white'}`}>Notifications</button>
            <button onClick={() => setTab('home')} className={`p-3 rounded-xl text-xs font-bold text-left ${tab==='home'?'bg-black text-white':'hover:bg-white'}`}>Accueil</button>
            <button onClick={() => window.location.reload()} className="mt-auto text-red-400 text-xs font-bold flex gap-2 items-center"><LogOut size={14}/> Quitter</button>
        </nav>
        {/* CONTENU SCROLLABLE */}
        <main className="flex-1 p-8 overflow-y-auto bg-white">
            {tab === 'users' && (
                <div className="space-y-4">
                    <h3 className="text-2xl font-cinzel font-bold">Utilisateurs</h3>
                    {users.map((u:any) => <div key={u.id} className="p-4 border rounded-2xl flex justify-between items-center"><span className="font-bold">{u.name || u.id}</span><span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : '-'}</span></div>)}
                </div>
            )}
            {tab === 'notif' && (
                <div className="space-y-4">
                    <h3 className="text-2xl font-cinzel font-bold">Envoyer Notification</h3>
                    <textarea value={notif.message} onChange={e => setNotif({...notif, message: e.target.value})} className="w-full p-4 bg-gray-50 rounded-2xl outline-none" placeholder="Message..." />
                    <button onClick={async () => { if(notif.message) { await addDoc(collection(db, 'notifications'), { ...notif, createdAt: new Date().toISOString(), readBy: {} }); alert('Envoyé'); setNotif({...notif, message: ''}); }}} className="w-full py-3 bg-black text-white rounded-xl font-bold">Envoyer</button>
                </div>
            )}
            {tab === 'home' && (
                <div className="space-y-6">
                    <h3 className="text-2xl font-cinzel font-bold">Modifier l'Accueil</h3>
                    <input value={localC.welcomeTitle} onChange={e => setLocalC({...localC, welcomeTitle: e.target.value})} className="w-full p-4 border rounded-2xl" placeholder="Titre" />
                    <textarea value={localC.welcomeText} onChange={e => setLocalC({...localC, welcomeText: e.target.value})} className="w-full p-4 border rounded-2xl h-32" placeholder="Texte" />
                    <button onClick={() => save(localC, true)} className="w-full py-3 bg-black text-white rounded-xl font-bold">Sauvegarder</button>
                </div>
            )}
        </main>
    </div>
  );
};

// ============================================================================
// 6. APPLICATION PRINCIPALE
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

  useEffect(() => {
    onAuthStateChanged(auth, async (u) => { setUser(u); if(u?.email) setDoc(doc(db, 'site_users', u.email), { email: u.email, lastLogin: new Date().toISOString() }, { merge: true }); });
    const unsubC = onSnapshot(doc(db, 'site_config', 'main'), (d) => d.exists() && setConfig(d.data() as SiteConfig));
    const unsubU = onSnapshot(collection(db, 'site_users'), (s) => { 
        const u = s.docs.map(d => ({id:d.id, ...d.data()})); 
        setData((p:any) => ({...p, users: u}));
        const m:any = {}; u.forEach((ux:any) => { if(usersMapping) m[ux.id] = ux.letter || ux.name?.[0] }); setUsersMapping(m);
    });
    const unsubR = onSnapshot(collection(db, 'family_recipes'), (s) => setRecipes(s.docs.map(d => ({ ...d.data(), id: d.id } as Recipe))));
    const unsubE = onSnapshot(collection(db, 'family_events'), (s) => { const rawEvents = s.docs.map(d => ({ ...d.data(), id: d.id } as FamilyEvent)); rawEvents.sort((a, b) => a.date.localeCompare(b.date)); setEvents(rawEvents); });
    const unsubT = onSnapshot(collection(db, 'chores_status'), (s) => { const status: Record<string, any> = {}; s.docs.forEach(doc => { status[doc.id] = doc.data(); }); setChoreStatus(status); });
    return () => { unsubC(); unsubU(); unsubR(); unsubE(); unsubT(); };
  }, []);

  const addEntry = async (col: string, val: any) => addDoc(collection(db, col), val);
  const updateEntry = async (col: string, id: string, data: any) => setDoc(doc(db, col, id), { ...data, timestamp: serverTimestamp() }, { merge: true });
  const deleteItem = async (col: string, id: string) => deleteDoc(doc(db, col, id));
  const openEditRecipe = (recipe: any) => { const ingredientsStr = Array.isArray(recipe.ingredients) ? recipe.ingredients.join('\n') : recipe.ingredients; const stepsStr = recipe.steps || recipe.instructions || ''; setCurrentRecipe({ ...recipe, ingredients: ingredientsStr, steps: stepsStr }); setIsRecipeModalOpen(true); };
  const handleAiRecipe = async () => { if (!aiLink.trim()) return; setIsAiLoading(true); const res = await extractRecipeFromUrl(aiLink); if (res) setCurrentRecipe({ ...currentRecipe, ...res }); setAiLink(''); setIsAiLoading(false); };
  const addRecipeToHub = (r:any) => {}; 
  const toggleChore = async (weekId: string, letter: string) => { try { const currentStatus = choreStatus[weekId]?.[letter] || false; await setDoc(doc(db, 'chores_status', weekId), { [letter]: !currentStatus }, { merge: true }); } catch (e) { console.error("Erreur coche", e); } };
  const saveConfig = async (c: SiteConfig, saveHistory = false) => { try { await setDoc(doc(db, 'site_config', 'main'), c); setConfig(c); if(saveHistory) await addDoc(collection(db, 'site_versions'), { name: `Sauvegarde`, date: new Date().toISOString(), config: c }); } catch(e) { console.error(e); } };

  if (!user) return <div className="h-screen flex flex-col items-center justify-center bg-[#f5ede7] p-6"><Background color="#a85c48"/><h1 className="text-4xl font-cinzel font-black text-[#a85c48] mb-8">CHAUD DEVANT</h1><button onClick={() => signInWithPopup(auth, googleProvider)} className="bg-white px-8 py-4 rounded-2xl shadow-xl font-bold flex items-center gap-3"><LogIn/> Google</button></div>;

  const myLetter = user && user.email ? (usersMapping[user.email] || user.email.charAt(0).toUpperCase()) : null;

  return (
    <div className="min-h-screen pb-24 md:pb-0" style={{ backgroundColor: config.backgroundColor, fontFamily: config.fontFamily }}>
        <Background color={config.primaryColor} />
        
        <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md z-50 h-20 px-6 flex items-center justify-between border-b border-black/5">
            <div onClick={() => setCurrentView('home')} className="flex items-center gap-3 cursor-pointer"><div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ backgroundColor: config.primaryColor }}><Home className="text-white" size={20} /></div><span className="font-cinzel font-black text-xl hidden md:block" style={{ color: config.primaryColor }}>CHAUD.DEVANT</span></div>
            <div className="flex gap-4">
                <button onClick={() => setCurrentView('edit')} className="p-2 hover:bg-gray-100 rounded-full"><Settings/></button>
            </div>
        </nav>

        <SideMenu config={config} isOpen={false} close={() => {}} setView={setCurrentView} logout={() => signOut(auth)} />
        <BottomNav config={config} view={currentView} setView={setCurrentView} />

        <main className="max-w-7xl mx-auto px-6 pt-28 pb-32 relative z-10">
            {currentView === 'home' && (
                <div className="grid grid-cols-2 gap-4 animate-in fade-in">
                    <HomeCard icon={<LayoutDashboard size={40}/>} title="Tableau" label="Hub" onClick={() => setCurrentView('hub')} color={config.primaryColor} />
                    <HomeCard icon={<UtensilsCrossed size={40}/>} title="Frigo" label="Scanner" onClick={() => setCurrentView('fridge')} color={config.primaryColor} />
                    <HomeCard icon={<CalIcon size={40}/>} title="Semainier" label="Menu" onClick={() => setCurrentView('cooking')} color={config.primaryColor} />
                    <HomeCard icon={<ChefHat size={40}/>} title="Recettes" label="Chef" onClick={() => setCurrentView('recipes')} color={config.primaryColor} />
                    <HomeCard icon={<CheckSquare size={40}/>} title="Tâches" label="Ménage" onClick={() => setCurrentView('tasks')} color={config.primaryColor} />
                    <HomeCard icon={<Wallet size={40}/>} title="Tirelire" label="Comptes" onClick={() => setCurrentView('wallet')} color={config.primaryColor} />
                </div>
            )}
            {currentView === 'hub' && (
                <>
                    <HubView user={user} config={config} usersMapping={usersMapping} onAddItem={addEntry} />
                    <ButlerFloating chatHistory={chatHistory} setChatHistory={setChatHistory} isAiLoading={isAiLoading} setIsAiLoading={setIsAiLoading} onAction={(type: string, item: string) => addEntry('hub_items', { type: 'shop', content: item, category: categorizeShoppingItem(item), store: 'Divers', author: 'Majordome', createdAt: new Date().toISOString() })} />
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
                <div className="max-w-3xl mx-auto space-y-10" id="calendar-view">
                    <div className="flex flex-col items-center gap-6"><h2 className="text-5xl font-cinzel font-black" style={{ color: config.primaryColor }}>CALENDRIER</h2><button onClick={() => setIsEventModalOpen(true)} className="bg-black text-white px-8 py-4 rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform flex items-center gap-3 shadow-xl" style={{ backgroundColor: config.primaryColor }}><Plus size={20}/> Ajouter un événement</button></div>
                    <EventModal isOpen={isEventModalOpen} onClose={setIsEventModalOpen} config={config} addEntry={addEntry} newEvent={newEvent} setNewEvent={setNewEvent} />
                    <div className="space-y-4">{events.map(ev => { const cleanDate = ev.date.split('T')[0]; const dateObj = new Date(cleanDate); return (<div key={ev.id} className="flex items-center gap-6 p-6 bg-white rounded-2xl shadow-sm border border-black/5 hover:shadow-md transition-shadow group"><div className="text-center w-16"><div className="font-bold text-xl leading-none" style={{color: config.primaryColor}}>{dateObj.getDate()}</div><div className="text-[10px] uppercase font-bold text-gray-400">{dateObj.toLocaleString('fr-FR', { month: 'short' })}</div></div><div className="flex-1 border-l pl-6 border-gray-100"><div className="font-bold text-lg font-cinzel text-gray-800">{ev.title}</div>{ev.time && <div className="text-xs text-gray-400 flex items-center mt-1"><Clock size={10} className="mr-1"/> {ev.time}</div>}</div><button onClick={() => deleteItem('family_events', ev.id)} className="opacity-0 group-hover:opacity-100 p-2 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all" title="Supprimer"><Trash2 size={16} /></button></div>); })}</div>
                </div>
            )}
            {currentView === 'edit' && user.email === ADMIN_EMAIL && <AdminPanel config={config} save={saveConfig} users={data.users} />}
            {currentView === 'edit' && user.email !== ADMIN_EMAIL && <div className="text-center p-10"><ShieldAlert className="mx-auto text-red-500 mb-4" size={48}/><h2 className="text-2xl font-bold">Accès Refusé</h2></div>}
        </main>
    </div>
  );
};

export default App;
