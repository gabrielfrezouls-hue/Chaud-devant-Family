import React, { useState, useEffect, useRef, useCallback } from 'react';
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import {
  collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, updateDoc,
  where, getDoc, getDocs, arrayUnion, arrayRemove
} from 'firebase/firestore';
import {
  Lock, Menu, X, Home, BookHeart, ChefHat, Wallet, PiggyBank,
  Calendar as CalIcon, Settings, Code, Sparkles, Send, History,
  MessageSquare, ChevronRight, LogIn, Loader2, ShieldAlert, RotateCcw, ArrowLeft, Trash2, Pencil, ClipboardList,
  CheckSquare, Square, CheckCircle2, Plus, Minus, Clock, Save, ToggleLeft, ToggleRight, Upload, Image as ImageIcon, Book, Download, TrendingUp, TrendingDown, Percent, Target,
  Map, MonitorPlay, Eye, QrCode, Star, Maximize2, Minimize2, ExternalLink, Link, Copy, LayoutDashboard, ShoppingCart, StickyNote, Users, ShoppingBag, Bell, Mail, CornerDownRight, Store, CalendarClock,
  Refrigerator, Scan, Camera, AlertTriangle, Bot, Flame, Info, Package, Barcode, Brain
} from 'lucide-react';
import { Recipe, FamilyEvent, ViewType, SiteConfig, SiteVersion } from './types';
import { askAIArchitect, askAIChat, askButlerAgent, scanProductImage, extractRecipeFromUrl } from './services/geminiService';
import Background from './components/Background';
import RecipeCard from './components/RecipeCard';

// --- SÉCURITÉ ---
const ADMIN_EMAIL = "gabriel.frezouls@gmail.com";

// --- LISTE MAGASINS ---
const COMMON_STORES = [
  "Auchan","Lidl","Carrefour","Leclerc","Grand Frais","Intermarché","Super U","Monoprix",
  "Marché","Drive","Biocoop","Picard","Thiriet","Action","Gifi","La Foir'Fouille","Hema",
  "Pharmacie","Boulangerie","Boucherie","Tabac/Presse","Amazon","Cdiscount","Relais Colis",
  "Leroy Merlin","Castorama","Brico Dépôt","IKEA","Jardinerie","Truffaut",
  "Cultura","Fnac","Boulanger","Darty","Decathlon","Intersport","Go Sport",
  "Sephora","Nocibé","Marionnaud","Zara","H&M","Kiabi","Vinted"
];

// --- TYPES ---
interface AppNotification {
  id: string; message: string; type: 'info'|'alert'|'fun';
  repeat: 'once'|'daily'|'monthly'; targets: string[];
  scheduledFor?: string; linkView?: string; linkId?: string;
  createdAt: string; readBy: Record<string,string>;
}
interface FrigoItem {
  id: string; name: string; category: string; quantity: number; unit: string;
  expiryDate?: string; barcode?: string; addedAt: string;
}
interface ChatMessage { role: 'user'|'assistant'; text: string; }

// --- ANCRES ---
const VIEW_ANCHORS: Record<string,{label:string,id:string}[]> = {
  home:[{label:'Haut de page',id:'top'},{label:'Widget HTML',id:'home-widget'},{label:'Accès Rapides',id:'home-shortcuts'}],
  hub:[{label:'Haut de page',id:'top'},{label:'Saisie Rapide',id:'hub-input'},{label:'Liste de Courses',id:'hub-shop'},{label:'Pense-bêtes',id:'hub-notes'},{label:'Le Mur',id:'hub-msg'}],
  recipes:[{label:'Haut de page',id:'top'},{label:'Liste des recettes',id:'recipes-list'}],
  wallet:[{label:'Haut de page',id:'top'},{label:'Graphique Solde',id:'wallet-graph'},{label:'Dettes Famille',id:'wallet-debts'}],
  tasks:[{label:'Tableau',id:'tasks-table'}],
  calendar:[{label:'Calendrier',id:'calendar-view'}],
  cooking:[{label:'Semainier',id:'cooking-frame'}],
  frigo:[{label:'Inventaire',id:'frigo-list'}]
};

// --- CONFIG PAR DÉFAUT ---
const ORIGINAL_CONFIG: SiteConfig = {
  primaryColor: '#a85c48', backgroundColor: '#f5ede7', fontFamily: 'Montserrat',
  welcomeTitle: 'CHAUD DEVANT',
  welcomeText: "Bienvenue dans l'espace sacré de notre famille.",
  welcomeImage: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?q=80&w=2070&auto=format&fit=crop',
  navigationLabels: { home:'ACCUEIL', hub:'LE TABLEAU', xsite:'XSITE', cooking:'SEMAINIER', recipes:'RECETTES', calendar:'CALENDRIER', tasks:'TÂCHES', wallet:'PORTE-MONNAIE', frigo:'FRIGO' },
  homeHtml: '', cookingHtml: '',
  isLocked: false
};

// --- LOGIQUE INTELLIGENTE HUB ---
const categorizeShoppingItem = (text: string) => {
  const lower = text.toLowerCase();
  if(/(lait|beurre|yaourt|creme|crème|oeuf|fromage|gruyere|mozarella|skyr)/.test(lower)) return 'Frais & Crèmerie';
  if(/(pomme|banane|legume|fruit|salade|tomate|carotte|oignon|ail|patate|courgette|avocat|citron|poireau)/.test(lower)) return 'Primeur';
  if(/(viande|poulet|poisson|jambon|steak|lardon|saucisse|dinde|boeuf|thon|saumon|crevette)/.test(lower)) return 'Boucherie/Poisson';
  if(/(pain|baguette|brioche|croissant|pain de mie|burger)/.test(lower)) return 'Boulangerie';
  if(/(pates|pâte|riz|conserve|huile|vinaigre|moutarde|sel|poivre|epice|sauce|mayo|ketchup|bocal)/.test(lower)) return 'Épicerie Salée';
  if(/(sucre|farine|chocolat|gateau|biscuit|cereale|miel|confiture|nutella|bonbon|chips|apero)/.test(lower)) return 'Épicerie Sucrée';
  if(/(coca|jus|vin|biere|bière|eau|sirop|soda|alcool|cafe|the|tisane)/.test(lower)) return 'Boissons';
  if(/(shampoing|savon|dentifrice|papier|toilette|douche|cosmetique|coton|rasoir|deo)/.test(lower)) return 'Hygiène & Beauté';
  if(/(lessive|eponge|sac|poubelle|nettoyant|vaisselle|javel|sopalin)/.test(lower)) return 'Entretien Maison';
  if(/(glace|surgeles|pizza|frite|poelee)/.test(lower)) return 'Surgelés';
  return 'Divers';
};

// --- TÂCHES MÉNAGÈRES ---
const ROTATION = ['G','P','V'];
const REF_DATE = new Date('2025-12-20T12:00:00');
const getChores = (date: Date) => {
  const saturday = new Date(date);
  saturday.setDate(date.getDate() - (date.getDay()+1)%7);
  saturday.setHours(12,0,0,0);
  const weekId = `${saturday.getDate()}-${saturday.getMonth()+1}-${saturday.getFullYear()}`;
  const diffTime = saturday.getTime() - REF_DATE.getTime();
  const diffWeeks = Math.floor(diffTime/(1000*60*60*24*7));
  const mod = (n:number,m:number) => ((n%m)+m)%m;
  return { id:weekId, fullDate:saturday, dateStr:`${saturday.getDate()}/${saturday.getMonth()+1}`, haut:ROTATION[mod(diffWeeks,3)], bas:ROTATION[mod(diffWeeks+2,3)], douche:ROTATION[mod(diffWeeks+1,3)] };
};
const getMonthWeekends = () => {
  const today = new Date(); const year = today.getFullYear(); const month = today.getMonth();
  const weekends: any[] = []; const date = new Date(year,month,1);
  while(date.getDay()!==6) date.setDate(date.getDate()+1);
  while(date.getMonth()===month) { weekends.push(getChores(new Date(date))); date.setDate(date.getDate()+7); }
  return weekends;
};

// --- GRAPHIQUES ---
const SimpleLineChart = ({ data, color }: { data:any[], color:string }) => {
  if(!data||data.length<2) return <div className="h-full flex items-center justify-center text-gray-300 italic text-xs">Pas assez de données</div>;
  const width=300,height=100,padding=5;
  const values = data.map(d=>d.solde);
  const min=Math.min(...values), max=Math.max(...values);
  const range=max-min||1;
  const points = data.map((d,i)=>{
    const x=(i/(data.length-1))*(width-padding*2)+padding;
    const y=height-((d.solde-min)/range)*(height-padding*2)-padding;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="3" points={points} strokeLinecap="round" strokeLinejoin="round"/>
      {data.map((d,i)=>{
        const x=(i/(data.length-1))*(width-padding*2)+padding;
        const y=height-((d.solde-min)/range)*(height-padding*2)-padding;
        return <g key={i}><circle cx={x} cy={y} r="3" fill="white" stroke={color} strokeWidth="2"/></g>;
      })}
    </svg>
  );
};

const CircleLiquid = ({ fillPercentage }: { fillPercentage:number }) => {
  const safePercent = isNaN(fillPercentage)?0:Math.min(Math.max(fillPercentage,0),100);
  const size=200, radius=90, center=size/2;
  const liquidHeight=(safePercent/100)*size;
  const liquidY=size-liquidHeight;
  return (
    <div className="relative w-full h-full flex justify-center items-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full drop-shadow-xl overflow-visible">
        <defs>
          <clipPath id="circleClip"><circle cx={center} cy={center} r={radius}/></clipPath>
          <linearGradient id="liquidGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#facc15"/><stop offset="100%" stopColor="#ca8a04"/>
          </linearGradient>
        </defs>
        <circle cx={center} cy={center} r={radius} fill="#fef9c3"/>
        <rect x="0" y={liquidY} width={size} height={liquidHeight} fill="url(#liquidGrad)" clipPath="url(#circleClip)" className="transition-all duration-1000 ease-in-out"/>
        <circle cx={center} cy={center} r={radius} fill="none" stroke="#eab308" strokeWidth="6"/>
      </svg>
    </div>
  );
};

// ==========================================
// COMPOSANT FRIGO
// ==========================================
const FrigoView = ({ user, config }: { user:User, config:SiteConfig }) => {
  const [items, setItems] = useState<FrigoItem[]>([]);
  const [newItem, setNewItem] = useState({ name:'', quantity:1, unit:'pcs', expiryDate:'' });
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  // Ref pour l'input fichier IA Photo (chargeur de médias standard)
  const photoInputRef = useRef<HTMLInputElement>(null);
  // Ref pour la photo de code-barre via IA
  const barcodePhotoRef = useRef<HTMLInputElement>(null);

  // Analyse une photo pour en extraire le code-barre via geminiService
  const handleBarcodePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if(!file) return;
    e.target.value = '';
    setIsLoading(true);
    setScanMsg('⏳ Lecture du code-barre en cours...');
    try {
      const { readBarcodeFromImage } = await import('./services/geminiService');
      const code = await readBarcodeFromImage(file);
      if(code) {
        setScanMsg(`✅ Code détecté : ${code} — Recherche produit...`);
        await fetchProductByBarcode(code);
      } else {
        setScanMsg('❌ Aucun code-barre lisible sur cette photo.');
        setIsLoading(false);
      }
    } catch {
      setScanMsg('❌ Erreur lors de la lecture du code-barre.');
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const q = query(collection(db,'frigo_items'), orderBy('addedAt','desc'));
    const unsub = onSnapshot(q, s => setItems(s.docs.map(d=>({id:d.id,...d.data()} as FrigoItem))));
    return ()=>unsub();
  },[]);

  const addItem = async () => {
    if(!newItem.name.trim()) return;
    setIsLoading(true);
    setScanMsg('⏳ Classification IA en cours...');
    try {
      const { classifyFrigoItem } = await import('./services/geminiService');
      const aiResult = await classifyFrigoItem(newItem.name.trim());
      const category = aiResult?.category || categorizeShoppingItem(newItem.name);
      const expiryDate = newItem.expiryDate || aiResult?.expiryDate || '';
      await addDoc(collection(db,'frigo_items'),{
        ...newItem,
        name: newItem.name.trim(),
        category,
        expiryDate,
        addedAt: new Date().toISOString()
      });
      setScanMsg(`✅ "${newItem.name.trim()}" → ${category}${expiryDate ? ` · péremption ${expiryDate}` : ''}`);
      setNewItem({name:'',quantity:1,unit:'pcs',expiryDate:''});
      setTimeout(()=>setScanMsg(''), 4000);
    } catch {
      // Fallback silencieux si IA indisponible
      await addDoc(collection(db,'frigo_items'),{
        ...newItem, name:newItem.name.trim(),
        category: categorizeShoppingItem(newItem.name),
        addedAt: new Date().toISOString()
      });
      setNewItem({name:'',quantity:1,unit:'pcs',expiryDate:''});
      setScanMsg('');
    }
    setIsLoading(false);
  };

  const fetchProductByBarcode = async (code:string) => {
    setIsLoading(true);
    setScanMsg('');
    try {
      const resp = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
      const data = await resp.json();
      if(data.status===1&&data.product) {
        const p = data.product;
        const name = p.product_name_fr||p.product_name||'Produit inconnu';
        const category = categorizeShoppingItem(name);
        await addDoc(collection(db,'frigo_items'),{
          name, category,
          quantity:1, unit:'pcs',
          barcode:code, addedAt:new Date().toISOString()
        });
        setScanMsg(`✅ "${name}" (${category}) ajouté !`);
      } else { setScanMsg('❌ Produit introuvable dans OpenFoodFacts.'); }
    } catch { setScanMsg('❌ Erreur réseau.'); }
    setIsLoading(false);
    setBarcodeInput('');
  };

  // IA Photo : via sélecteur de fichiers/médias standard du navigateur
  // accept="image/*" + capture="environment" → propose Caméra + Galerie sur mobile
  const handlePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if(!file) return;
    e.target.value = '';
    setIsLoading(true);
    setScanMsg('⏳ Analyse IA en cours...');
    try {
      const result = await scanProductImage(file);
      if(result && result.name) {
        // La catégorie retournée par l'IA correspond directement aux clés SHELF_LIFE
        // L'expiryDate est estimée par l'IA selon les règles métier
        await addDoc(collection(db,'frigo_items'),{
          name: result.name,
          category: result.category || categorizeShoppingItem(result.name),
          expiryDate: result.expiryDate || '',
          quantity: 1, unit: 'pcs',
          addedAt: new Date().toISOString()
        });
        setScanMsg(`✅ "${result.name}" (${result.category}) — péremption le ${result.expiryDate || 'estimée auto'}`);
      } else {
        setScanMsg('❌ Produit non reconnu. Essayez une autre photo.');
      }
    } catch { setScanMsg('❌ Erreur lors de l\'analyse.'); }
    setIsLoading(false);
  };

  const deleteItem = async (id:string) => { await deleteDoc(doc(db,'frigo_items',id)); };

  // Durée de conservation (jours) selon la catégorie
  const SHELF_LIFE: Record<string,number> = {
    'Boucherie/Poisson': 3,
    'Boulangerie': 3,
    'Plat préparé': 4,
    'Restes': 4,
    'Primeur': 7,
    'Frais & Crèmerie': 10,
    'Épicerie Salée': 90,
    'Épicerie Sucrée': 90,
    'Boissons': 90,
    'Surgelés': 90,
    'Divers': 14,
  };

  // Calcule la date limite estimée à partir de la date d'ajout et de la catégorie
  const estimateExpiryFromCategory = (addedAt:string, category:string): string => {
    const days = SHELF_LIFE[category] ?? 14;
    const d = new Date(addedAt);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  };

  const getExpiryStatus = (item: FrigoItem) => {
    // Date limite : expiryDate saisie, sinon estimée depuis addedAt + catégorie
    let expiryStr = item.expiryDate;
    if(!expiryStr && item.addedAt) {
      expiryStr = estimateExpiryFromCategory(item.addedAt, item.category);
    }
    if(!expiryStr) return null;
    const [y,m,d] = expiryStr.split('-').map(Number);
    const exp = new Date(y, m-1, d);
    const now = new Date(); now.setHours(0,0,0,0);
    const diff = Math.ceil((exp.getTime()-now.getTime())/(1000*60*60*24));
    if(diff < 0) return { label:'Périmé', color:'bg-red-100 text-red-700', icon:'🔴' };
    if(diff <= 3) return { label:`J-${diff}`, color:'bg-orange-100 text-orange-700', icon:'🟠' };
    return { label:`J-${diff}`, color:'bg-green-100 text-green-700', icon:'🟢' };
  };

  const expiringSoon = items.filter(i=>{
    const s = getExpiryStatus(i);
    return s && (s.icon==='🔴' || s.icon==='🟠');
  });

  return (
    <div className="space-y-8 pb-24 animate-in fade-in" id="frigo-list">
      {/* ALERTES ANTI-GASPI */}
      {expiringSoon.length>0 && (
        <div className="bg-red-50 border-2 border-red-200 rounded-3xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="text-red-500" size={24}/>
            <h3 className="font-black text-red-700 uppercase tracking-widest text-sm">⚠️ BIENTÔT PÉRIMÉS — Anti-gaspi activé</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {expiringSoon.map(i=>(
              <span key={i.id} className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold">
                {i.name} — {getExpiryStatus(i)?.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* SAISIE PRINCIPALE */}
      <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-gray-100 space-y-4">
        <h3 className="font-black uppercase tracking-widest text-gray-400 text-xs flex items-center gap-2"><Plus size={14}/> AJOUTER UN PRODUIT</h3>
        
        <div className="flex gap-2">
          <input value={newItem.name} onChange={e=>setNewItem({...newItem,name:e.target.value})} onKeyDown={e=>e.key==='Enter'&&addItem()} placeholder="Nom du produit..." className="flex-1 p-4 bg-gray-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-black transition-colors"/>
          <input type="number" value={newItem.quantity} onChange={e=>setNewItem({...newItem,quantity:parseInt(e.target.value)||1})} className="w-16 p-4 bg-gray-50 rounded-2xl font-bold text-center outline-none" min={1}/>
          <select value={newItem.unit} onChange={e=>setNewItem({...newItem,unit:e.target.value})} className="p-4 bg-gray-50 rounded-2xl font-bold outline-none">
            <option>pcs</option><option>g</option><option>kg</option><option>ml</option><option>L</option><option>boîte</option>
          </select>
        </div>
        
        <div className="flex gap-2 items-center">
          <CalIcon size={16} className="text-gray-400"/>
          <input type="date" value={newItem.expiryDate} onChange={e=>setNewItem({...newItem,expiryDate:e.target.value})} className="flex-1 p-3 bg-gray-50 rounded-xl font-bold text-sm outline-none"/>
          <button onClick={addItem} className="px-6 py-3 bg-black text-white rounded-2xl font-bold hover:scale-105 transition-transform"><Plus size={18}/></button>
        </div>

        {/* SCAN CODE-BARRE + IA PHOTO (sélecteur de médias) */}
        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <div className="flex-1 flex gap-2">
            <input value={barcodeInput} onChange={e=>setBarcodeInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&fetchProductByBarcode(barcodeInput)} placeholder="Saisir ou photographier un code-barre..." className="flex-1 p-3 bg-gray-50 rounded-xl font-mono text-sm outline-none border-2 border-transparent focus:border-blue-400"/>
            {/* Si champ vide → ouvre l'appareil photo pour lire le code-barre par IA */}
            {/* Si champ rempli → soumet le code directement */}
            <input ref={barcodePhotoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleBarcodePhoto}/>
            <button
              onClick={()=>{ barcodeInput.trim() ? fetchProductByBarcode(barcodeInput) : barcodePhotoRef.current?.click(); }}
              disabled={isLoading}
              className="px-4 py-3 bg-blue-500 text-white rounded-xl hover:scale-105 transition-transform flex items-center gap-2 disabled:opacity-50"
              title={barcodeInput.trim() ? "Rechercher ce code-barre" : "Photographier un code-barre"}
            >
              {isLoading?<Loader2 size={16} className="animate-spin"/>: barcodeInput.trim() ? <Barcode size={16}/> : <Camera size={16}/>}
            </button>
          </div>
          {/* Bouton IA Photo produit (reconnaissance visuelle du produit) */}
          <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoFile}/>
          <button
            onClick={()=>photoInputRef.current?.click()}
            disabled={isLoading}
            className="px-4 py-3 bg-purple-500 text-white rounded-xl hover:scale-105 transition-transform flex items-center gap-2 disabled:opacity-50"
            title="Identifier un produit par photo (IA)"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin"/> : <Brain size={16}/>}
            <span className="text-xs font-bold hidden sm:block">IA Photo</span>
          </button>
        </div>
        {scanMsg&&<div className={`text-center text-sm font-bold py-2 px-4 rounded-xl ${scanMsg.startsWith('✅')?'bg-green-50 text-green-700':scanMsg.startsWith('⏳')?'bg-blue-50 text-blue-700':'bg-red-50 text-red-700'}`}>{scanMsg}</div>}
      </div>

      {/* INVENTAIRE */}
      <div className="bg-white/80 backdrop-blur-md p-6 rounded-[2.5rem] shadow-xl border border-gray-100">
        <h3 className="font-black uppercase tracking-widest text-gray-400 text-xs flex items-center gap-2 mb-6"><Refrigerator size={14}/> INVENTAIRE ({items.length} produits)</h3>
        {items.length===0&&<div className="text-center py-12 text-gray-300 italic">Frigo vide — ajoutez vos produits !</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(item=>{
            const expStatus=getExpiryStatus(item);
            return (
              <div key={item.id} className={`group flex justify-between items-center p-4 rounded-2xl border-l-4 transition-all hover:shadow-md ${expStatus?.icon==='🔴'?'bg-red-50 border-red-400':expStatus?.icon==='🟠'?'bg-orange-50 border-orange-400':'bg-gray-50 border-gray-200'}`}>
                <div>
                  <span className="font-bold text-gray-800 block">{item.name}</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-bold text-gray-400">{item.quantity} {item.unit}</span>
                    {expStatus&&<span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${expStatus.color}`}>{expStatus.icon} {expStatus.label}</span>}
                  </div>
                </div>
                <button onClick={()=>deleteItem(item.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity"><X size={16}/></button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ==========================================
// COMPOSANT MAJORDOME IA (Flottant dans HUB)
// ==========================================
const MajordomeChat = ({ user, config, hubItems, addHubItem }: { user:User, config:SiteConfig, hubItems:any[], addHubItem:(content:string)=>void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role:'assistant', text:'Bonjour ! Je suis votre Majordome. Je peux vous conseiller, organiser votre frigo, ou ajouter des éléments à votre liste de courses. Que puis-je faire pour vous ?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{ if(scrollRef.current) scrollRef.current.scrollTop=scrollRef.current.scrollHeight; },[messages,isOpen]);

  const send = async () => {
    if(!input.trim()||isLoading) return;
    const userMsg = input.trim();
    setInput('');
    const newMsgs:ChatMessage[] = [...messages,{role:'user',text:userMsg}];
    setMessages(newMsgs);
    setIsLoading(true);

    // Contexte passé au service Gemini
    const shopItems = hubItems.filter(i=>i.type==='shop').map(i=>i.content).join(', ');
    const contextData = { shopItems: shopItems||'vide' };

    try {
      // askButlerAgent retourne { type: 'action'|'text', data: ... }
      const result = await askButlerAgent(
        newMsgs.map(m=>({ role: m.role, text: m.text })),
        contextData
      );

      if(result.type === 'action' && result.data?.action === 'ADD_HUB') {
        // Action d'ajout au panier
        addHubItem(result.data.item);
        const replyText = result.data.reply || `✅ "${result.data.item}" ajouté à la liste de courses.`;
        setMessages([...newMsgs,{role:'assistant',text:replyText}]);
      } else {
        const text = result.data || 'Désolé, une erreur est survenue.';
        setMessages([...newMsgs,{role:'assistant',text}]);
      }
    } catch { setMessages([...newMsgs,{role:'assistant',text:'Erreur de connexion au Majordome.'}]); }
    setIsLoading(false);
  };

  return (
    <>
      {/* BOUTON FLOTTANT */}
      <button onClick={()=>setIsOpen(true)} className="fixed bottom-28 md:bottom-8 right-6 z-50 w-14 h-14 rounded-full text-white shadow-2xl flex items-center justify-center hover:scale-110 transition-transform" style={{backgroundColor:config.primaryColor}}>
        <Bot size={24}/>
      </button>

      {/* FENÊTRE CHAT */}
      {isOpen&&(
        <div className="fixed bottom-28 md:bottom-8 right-6 z-[80] w-80 md:w-96 bg-white rounded-3xl shadow-2xl border border-gray-100 flex flex-col" style={{height:'480px'}}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100 rounded-t-3xl" style={{backgroundColor:config.primaryColor}}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center"><Bot size={16} className="text-white"/></div>
              <div><div className="font-black text-white text-sm">LE MAJORDOME</div><div className="text-white/60 text-[10px]">Conseiller IA de la famille</div></div>
            </div>
            <button onClick={()=>setIsOpen(false)} className="text-white/60 hover:text-white"><X size={20}/></button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m,i)=>(
              <div key={i} className={`flex ${m.role==='user'?'justify-end':''}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${m.role==='user'?'text-white rounded-tr-sm':'bg-gray-50 text-gray-700 rounded-tl-sm'}`} style={m.role==='user'?{backgroundColor:config.primaryColor}:{}}>
                  <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                </div>
              </div>
            ))}
            {isLoading&&<div className="flex"><div className="bg-gray-50 p-3 rounded-2xl rounded-tl-sm"><div className="flex gap-1">{[0,1,2].map(i=><div key={i} className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:`${i*0.15}s`}}/>)}</div></div></div>}
          </div>

          <div className="p-4 border-t border-gray-100 flex gap-2">
            <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="Demandez au Majordome..." className="flex-1 p-3 bg-gray-50 rounded-xl text-sm font-bold outline-none"/>
            <button onClick={send} disabled={isLoading} className="p-3 text-white rounded-xl hover:scale-105 transition-transform" style={{backgroundColor:config.primaryColor}}><Send size={16}/></button>
          </div>
        </div>
      )}
    </>
  );
};

// ==========================================
// COMPOSANT HUB (TABLEAU)
// ==========================================
const HubView = ({ user, config, usersMapping }: { user:User, config:SiteConfig, usersMapping:any }) => {
  const [hubItems, setHubItems] = useState<any[]>([]);
  const [newItem, setNewItem] = useState('');
  const [storeSearch, setStoreSearch] = useState('');
  const [selectedStore, setSelectedStore] = useState('');
  const [inputType, setInputType] = useState<'shop'|'note'|'msg'>('shop');
  const [showStoreList, setShowStoreList] = useState(false);

  useEffect(() => {
    const q=query(collection(db,'hub_items'),orderBy('createdAt','desc'));
    const unsub=onSnapshot(q,s=>setHubItems(s.docs.map(d=>({id:d.id,...d.data()}))));
    return ()=>unsub();
  },[]);

  const addItem = async (content?:string) => {
    const text = content||newItem;
    if(!text.trim()) return;
    let category='Général';
    if(inputType==='shop'||content) category=categorizeShoppingItem(text);
    await addDoc(collection(db,'hub_items'),{
      type: content?'shop':inputType, content:text, category,
      store: (inputType==='shop'||content)?(selectedStore||'Divers'):null,
      author: usersMapping[user.email!]||user.email?.charAt(0).toUpperCase(),
      createdAt: new Date().toISOString(), done:false
    });
    if(!content) { setNewItem(''); setStoreSearch(''); setSelectedStore(''); }
  };

  const deleteItem = async (id:string) => { await deleteDoc(doc(db,'hub_items',id)); };

  const sortedShopItems = hubItems.filter(i=>i.type==='shop').sort((a,b)=>{
    const storeA=a.store||'Z', storeB=b.store||'Z';
    if(storeA!==storeB) return storeA.localeCompare(storeB);
    return a.category.localeCompare(b.category);
  });

  const filteredStores=COMMON_STORES.filter(s=>s.toLowerCase().includes(storeSearch.toLowerCase()));

  return (
    <div className="space-y-8 pb-32 animate-in fade-in" id="top">
      {/* SAISIE RAPIDE */}
      <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-gray-100 sticky top-24 z-30" id="hub-input">
        <div className="flex gap-2 mb-4 justify-center">
          <button onClick={()=>setInputType('shop')} className={`flex-1 py-3 rounded-xl font-bold text-xs uppercase transition-all ${inputType==='shop'?'bg-orange-500 text-white shadow-lg scale-105':'bg-gray-100 text-gray-400'}`}><ShoppingCart size={16} className="inline mr-2"/>Course</button>
          <button onClick={()=>setInputType('note')} className={`flex-1 py-3 rounded-xl font-bold text-xs uppercase transition-all ${inputType==='note'?'bg-yellow-400 text-white shadow-lg scale-105':'bg-gray-100 text-gray-400'}`}><StickyNote size={16} className="inline mr-2"/>Note</button>
          <button onClick={()=>setInputType('msg')} className={`flex-1 py-3 rounded-xl font-bold text-xs uppercase transition-all ${inputType==='msg'?'bg-blue-500 text-white shadow-lg scale-105':'bg-gray-100 text-gray-400'}`}><MessageSquare size={16} className="inline mr-2"/>Msg</button>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input value={newItem} onChange={e=>setNewItem(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addItem()} placeholder={inputType==='shop'?"Ex: Lait, Beurre...":"Message..."} className="flex-1 p-4 rounded-2xl bg-gray-50 font-bold outline-none border-2 border-transparent focus:border-black transition-colors"/>
            <button onClick={()=>addItem()} className="p-4 bg-black text-white rounded-2xl hover:scale-105 transition-transform"><Plus/></button>
          </div>
          {inputType==='shop'&&(
            <div className="relative">
              <div className="flex items-center bg-gray-50 rounded-xl px-4 border border-gray-200">
                <Store size={16} className="text-gray-400 mr-2"/>
                <input value={storeSearch} onFocus={()=>setShowStoreList(true)} onChange={e=>{setStoreSearch(e.target.value);setSelectedStore(e.target.value);}} placeholder="Rechercher un magasin..." className="w-full py-3 bg-transparent text-xs font-bold outline-none text-gray-600"/>
              </div>
              {showStoreList&&storeSearch&&(
                <div className="absolute top-full left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto z-50">
                  {filteredStores.map(store=>(
                    <div key={store} onClick={()=>{setSelectedStore(store);setStoreSearch(store);setShowStoreList(false);}} className="p-3 text-xs font-bold hover:bg-gray-50 cursor-pointer border-b border-gray-50">{store}</div>
                  ))}
                  <div onClick={()=>{setSelectedStore(storeSearch);setShowStoreList(false);}} className="p-3 bg-orange-50 text-orange-600 text-xs font-bold hover:bg-orange-100 cursor-pointer flex items-center justify-between">
                    <span>Ajouter "{storeSearch}"</span><Plus size={14}/>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* GRILLE CONTENU */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* COURSES */}
        <div className="space-y-4" id="hub-shop">
          <h3 className="font-cinzel font-bold text-xl text-gray-400 flex items-center gap-2"><ShoppingCart size={20}/> LISTE DE COURSES</h3>
          {sortedShopItems.map(item=>(
            <div key={item.id} className="group flex justify-between items-center p-4 bg-white rounded-2xl shadow-sm border-l-4 border-orange-400 hover:shadow-md transition-all">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] font-black uppercase text-orange-600 bg-orange-100 px-2 py-0.5 rounded-md">{item.category}</span>
                  {item.store&&<span className="text-[9px] font-bold uppercase text-gray-400 bg-gray-100 px-2 py-0.5 rounded-md"><Store size={8} className="inline mr-1"/>{item.store}</span>}
                </div>
                <span className="font-bold text-gray-700 block">{item.content}</span>
              </div>
              <button onClick={()=>deleteItem(item.id)} className="text-gray-300 hover:text-red-500"><X size={18}/></button>
            </div>
          ))}
          {sortedShopItems.length===0&&<div className="text-center p-8 border-2 border-dashed border-gray-200 rounded-2xl text-gray-300">Frigo plein !</div>}
        </div>

        {/* PENSE-BÊTES */}
        <div className="space-y-4" id="hub-notes">
          <h3 className="font-cinzel font-bold text-xl text-gray-400 flex items-center gap-2"><StickyNote size={20}/> PENSE-BÊTES</h3>
          <div className="grid grid-cols-2 gap-2">
            {hubItems.filter(i=>i.type==='note').map(item=>(
              <div key={item.id} className="relative p-4 bg-yellow-50 rounded-xl shadow-sm border border-yellow-100 rotate-1 hover:rotate-0 transition-transform">
                <button onClick={()=>deleteItem(item.id)} className="absolute top-2 right-2 text-yellow-300 hover:text-red-500"><X size={14}/></button>
                <p className="font-handwriting font-bold text-yellow-900 text-sm">{item.content}</p>
                <div className="mt-2 text-[10px] text-yellow-600 font-bold uppercase text-right">- {item.author}</div>
              </div>
            ))}
          </div>
        </div>

        {/* LE MUR */}
        <div className="space-y-4" id="hub-msg">
          <h3 className="font-cinzel font-bold text-xl text-gray-400 flex items-center gap-2"><MessageSquare size={20}/> LE MUR</h3>
          {hubItems.filter(i=>i.type==='msg').map(item=>(
            <div key={item.id} className="p-6 bg-blue-500 text-white rounded-tr-3xl rounded-bl-3xl rounded-tl-xl rounded-br-xl shadow-lg relative group">
              <button onClick={()=>deleteItem(item.id)} className="absolute top-2 right-2 text-blue-300 hover:text-white"><X size={14}/></button>
              <p className="font-bold text-lg leading-tight">"{item.content}"</p>
              <p className="mt-4 text-xs opacity-60 uppercase tracking-widest text-right">Posté par {item.author}</p>
            </div>
          ))}
        </div>
      </div>

      {/* MAJORDOME FLOTTANT */}
      <MajordomeChat user={user} config={config} hubItems={hubItems} addHubItem={(content)=>addItem(content)}/>
    </div>
  );
};

// ==========================================
// COMPOSANT PORTE-MONNAIE
// ==========================================
const WalletView = ({ user, config }: { user:User, config:SiteConfig }) => {
  const [activeTab, setActiveTab] = useState<'family'|'personal'>('family');
  const [chartRange, setChartRange] = useState<'1M'|'1Y'|'5Y'>('1M');
  const [debts, setDebts] = useState<any[]>([]);
  const [newDebt, setNewDebt] = useState({from:'',to:'',amount:'',interest:'',reason:''});
  const [myWallet, setMyWallet] = useState<any>(null);
  const [walletAmount, setWalletAmount] = useState('');
  const [newTask, setNewTask] = useState('');
  const [goalInput, setGoalInput] = useState('');

  useEffect(()=>{
    if(!user) return;
    const unsubDebts=onSnapshot(query(collection(db,'family_debts'),orderBy('createdAt','desc')),s=>setDebts(s.docs.map(d=>({id:d.id,...d.data()}))));
    const unsubWallet=onSnapshot(doc(db,'user_wallets',user.email!),s=>{
      if(s.exists()){const data=s.data();setMyWallet(data);if(data.savingsGoal)setGoalInput(data.savingsGoal.toString());}
      else{const init={balance:0,history:[],tasks:[],savingsGoal:0,startBalance:0};setDoc(doc(db,'user_wallets',user.email!),init);setMyWallet(init);}
    });
    return()=>{unsubDebts();unsubWallet();};
  },[user]);

  if(!myWallet&&activeTab==='personal') return <div className="flex justify-center p-10"><Loader2 className="animate-spin text-gray-400"/></div>;

  const addDebt=async()=>{
    if(!newDebt.from||!newDebt.to||!newDebt.amount)return alert("Remplissez les champs !");
    await addDoc(collection(db,'family_debts'),{...newDebt,amount:parseFloat(newDebt.amount),interest:parseFloat(newDebt.interest||'0'),createdAt:new Date().toISOString()});
    setNewDebt({from:'',to:'',amount:'',interest:'',reason:''});
  };

  const calculateDebt=(debt:any)=>{
    if(!debt.interest||debt.interest===0)return debt.amount;
    const start=new Date(debt.createdAt),now=new Date();
    const days=Math.floor((now.getTime()-start.getTime())/(1000*3600*24));
    return(debt.amount+debt.amount*(debt.interest/100)*(days/365)).toFixed(2);
  };

  const updateBalance=async(type:'add'|'sub')=>{
    const val=parseFloat(walletAmount);if(!val||val<=0)return;
    const newBal=type==='add'?myWallet.balance+val:myWallet.balance-val;
    const entry={date:new Date().toISOString(),amount:type==='add'?val:-val,newBalance:newBal,month:new Date().getMonth()};
    await updateDoc(doc(db,'user_wallets',user.email!),{balance:newBal,history:[...(myWallet.history||[]),entry]});
    setWalletAmount('');
  };

  const saveGoal=async()=>{const newVal=parseFloat(goalInput);if(!isNaN(newVal)&&newVal!==myWallet.savingsGoal){await updateDoc(doc(db,'user_wallets',user.email!),{savingsGoal:newVal,startBalance:myWallet.balance});}};
  const addWalletTask=async()=>{if(newTask){await updateDoc(doc(db,'user_wallets',user.email!),{tasks:[...(myWallet.tasks||[]),{id:Date.now(),text:newTask,done:false}]});setNewTask('');}};
  const toggleWalletTask=async(taskId:number)=>{const newTasks=myWallet.tasks.map((t:any)=>t.id===taskId?{...t,done:!t.done}:t);await updateDoc(doc(db,'user_wallets',user.email!),{tasks:newTasks});};
  const deleteWalletTask=async(taskId:number)=>{const newTasks=myWallet.tasks.filter((t:any)=>t.id!==taskId);await updateDoc(doc(db,'user_wallets',user.email!),{tasks:newTasks});};

  const getGraphData=()=>{
    if(!myWallet?.history)return[];
    const now=new Date();let cutoff=new Date();
    if(chartRange==='1M')cutoff.setMonth(now.getMonth()-1);
    if(chartRange==='1Y')cutoff.setFullYear(now.getFullYear()-1);
    if(chartRange==='5Y')cutoff.setFullYear(now.getFullYear()-5);
    const filtered=myWallet.history.filter((h:any)=>new Date(h.date)>=cutoff);
    filtered.sort((a:any,b:any)=>new Date(a.date).getTime()-new Date(b.date).getTime());
    return filtered.map((h:any)=>({name:new Date(h.date).toLocaleDateString(),solde:h.newBalance}));
  };

  const graphData=getGraphData();
  const currentMonthHistory=(myWallet?.history||[]).filter((h:any)=>new Date(h.date).getMonth()===new Date().getMonth());
  let fillPercent=0;
  if(myWallet&&(myWallet.savingsGoal-myWallet.startBalance)>0){fillPercent=((myWallet.balance-myWallet.startBalance)/(myWallet.savingsGoal-myWallet.startBalance))*100;}
  if(myWallet&&myWallet.balance>=myWallet.savingsGoal&&myWallet.savingsGoal>0)fillPercent=100;

  return (
    <div className="space-y-6 pb-20 animate-in fade-in" id="top">
      <div className="flex justify-center gap-4 mb-8">
        <button onClick={()=>setActiveTab('family')} className={`px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${activeTab==='family'?'bg-black text-white shadow-lg':'bg-white text-gray-400'}`}><ShieldAlert className="inline mr-2 mb-1" size={16}/>Dettes Famille</button>
        <button onClick={()=>setActiveTab('personal')} className={`px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${activeTab==='personal'?'bg-black text-white shadow-lg':'bg-white text-gray-400'}`}><PiggyBank className="inline mr-2 mb-1" size={16}/>Ma Tirelire</button>
      </div>
      {activeTab==='family'?(
        <div className="bg-white/80 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-xl border border-white space-y-8" id="wallet-debts">
          <div className="flex flex-col md:flex-row gap-4 items-end bg-gray-50 p-6 rounded-3xl">
            <div className="flex-1 w-full"><label className="text-[10px] font-bold uppercase text-gray-400 ml-2">Qui doit ?</label><input value={newDebt.from} onChange={e=>setNewDebt({...newDebt,from:e.target.value})} placeholder="ex: G" className="w-full p-3 rounded-xl border-none font-bold"/></div>
            <div className="flex-1 w-full"><label className="text-[10px] font-bold uppercase text-gray-400 ml-2">À qui ?</label><input value={newDebt.to} onChange={e=>setNewDebt({...newDebt,to:e.target.value})} placeholder="ex: P" className="w-full p-3 rounded-xl border-none font-bold"/></div>
            <div className="flex-1 w-full"><label className="text-[10px] font-bold uppercase text-gray-400 ml-2">Montant (€)</label><input type="number" value={newDebt.amount} onChange={e=>setNewDebt({...newDebt,amount:e.target.value})} placeholder="0" className="w-full p-3 rounded-xl border-none font-bold"/></div>
            <div className="w-24"><label className="text-[10px] font-bold uppercase text-gray-400 ml-2">Taux (%)</label><input type="number" value={newDebt.interest} onChange={e=>setNewDebt({...newDebt,interest:e.target.value})} placeholder="0%" className="w-full p-3 rounded-xl border-none font-bold text-orange-500"/></div>
            <button onClick={addDebt} className="p-4 bg-black text-white rounded-xl shadow-lg hover:scale-105 transition-transform"><Plus/></button>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {debts.map(d=>(
              <div key={d.id} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 relative group">
                <button onClick={()=>deleteDoc(doc(db,'family_debts',d.id))} className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 text-red-400"><Trash2 size={16}/></button>
                <div className="flex justify-between items-center mb-2"><span className="font-cinzel font-bold text-xl">{d.from}<span className="text-gray-300 text-xs mx-1">DOIT À</span>{d.to}</span><span className="text-2xl font-black" style={{color:config.primaryColor}}>{calculateDebt(d)}€</span></div>
                <div className="flex gap-4 text-[10px] font-bold uppercase text-gray-400"><span>Initial:{d.amount}€</span>{d.interest>0&&<span className="text-orange-400 flex items-center"><Percent size={10} className="mr-1"/>Intérêt:{d.interest}%</span>}<span>{new Date(d.createdAt).toLocaleDateString()}</span></div>
              </div>
            ))}
          </div>
        </div>
      ):(
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <div className="relative h-64 w-full"><CircleLiquid fillPercentage={fillPercent}/><div className="absolute inset-0 flex flex-col items-center justify-center"><p className="text-[10px] font-black uppercase text-yellow-800/60 tracking-widest mb-1">Solde Actuel</p><h2 className="text-5xl font-cinzel font-black text-yellow-900 drop-shadow-sm mb-4">{myWallet.balance?.toFixed(0)}€</h2><div className="flex items-center gap-2 bg-white/40 p-1.5 rounded-2xl backdrop-blur-sm shadow-sm border border-white/50 w-48"><button onClick={()=>updateBalance('sub')} className="p-2 bg-white/50 hover:bg-red-400 hover:text-white rounded-xl transition-colors"><Minus size={16}/></button><input type="number" value={walletAmount} onChange={e=>setWalletAmount(e.target.value)} className="w-full bg-transparent text-center font-bold text-lg outline-none text-yellow-900 placeholder-yellow-800/40" placeholder="..."/><button onClick={()=>updateBalance('add')} className="p-2 bg-white/50 hover:bg-green-400 hover:text-white rounded-xl transition-colors"><Plus size={16}/></button></div></div></div>
            <div className="bg-white p-4 rounded-3xl shadow-sm border border-yellow-100 flex items-center gap-3"><div className="p-3 bg-yellow-100 text-yellow-600 rounded-full"><Target size={20}/></div><div className="flex-1"><label className="text-[10px] font-bold uppercase text-gray-400">Objectif</label><input type="number" value={goalInput} onChange={e=>setGoalInput(e.target.value)} onBlur={saveGoal} className="w-full font-black text-gray-700 outline-none" placeholder="Définir..."/>{myWallet.startBalance>0&&<span className="text-[10px] text-gray-300">Départ:{myWallet.startBalance}€</span>}</div>{fillPercent>0&&<span className="text-xs font-bold text-yellow-600 bg-yellow-50 px-2 py-1 rounded-lg">{fillPercent.toFixed(0)}%</span>}</div>
            <div className="bg-white p-6 rounded-[2rem] shadow-lg border border-gray-100"><h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2"><ClipboardList size={14}/> Tâches Rémunérées</h3><div className="flex gap-2 mb-4"><input value={newTask} onChange={e=>setNewTask(e.target.value)} placeholder="Ajouter une tâche..." className="flex-1 bg-gray-50 rounded-xl px-3 text-sm font-bold outline-none"/><button onClick={addWalletTask} className="p-2 bg-gray-200 rounded-xl"><Plus size={16}/></button></div><div className="space-y-2 max-h-40 overflow-y-auto">{(myWallet.tasks||[]).map((t:any)=>(<div key={t.id} className="flex items-center gap-3 group"><button onClick={()=>toggleWalletTask(t.id)}>{t.done?<CheckCircle2 size={16} className="text-green-500"/>:<Square size={16} className="text-gray-300"/>}</button><span className={`text-sm font-bold flex-1 ${t.done?'line-through text-gray-300':'text-gray-600'}`}>{t.text}</span><button onClick={()=>deleteWalletTask(t.id)} className="opacity-0 group-hover:opacity-100 text-red-300"><X size={14}/></button></div>))}</div></div>
          </div>
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-gray-100 h-80 relative" id="wallet-graph"><div className="flex justify-between items-center mb-4"><h3 className="text-xs font-black uppercase tracking-widest text-gray-400">Évolution du Solde</h3><div className="flex bg-gray-100 p-1 rounded-lg">{(['1M','1Y','5Y'] as const).map(range=>(<button key={range} onClick={()=>setChartRange(range)} className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${chartRange===range?'bg-white shadow text-black':'text-gray-400'}`}>{range}</button>))}</div></div><div className="h-60 w-full p-2"><SimpleLineChart data={graphData} color={config.primaryColor}/></div></div>
            <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-gray-100"><div className="flex justify-between items-center mb-6"><h3 className="text-xs font-black uppercase tracking-widest text-gray-400 flex items-center gap-2"><History size={14}/> Historique (Ce Mois)</h3><span className="text-[10px] font-bold bg-gray-100 px-3 py-1 rounded-full text-gray-500">{new Date().toLocaleString('default',{month:'long'})}</span></div><div className="space-y-4 max-h-60 overflow-y-auto pr-2">{currentMonthHistory.length===0&&<div className="text-center text-gray-300 italic py-4">Aucun mouvement ce mois-ci</div>}{currentMonthHistory.slice().reverse().map((h:any,i:number)=>(<div key={i} className="flex justify-between items-center p-3 bg-gray-50 rounded-2xl"><div className="flex items-center gap-3"><div className={`p-2 rounded-full ${h.amount>0?'bg-green-100 text-green-600':'bg-red-100 text-red-600'}`}>{h.amount>0?<TrendingUp size={16}/>:<TrendingDown size={16}/>}</div><div className="text-xs font-bold text-gray-400 uppercase">{new Date(h.date).toLocaleDateString()}</div></div><span className={`font-black ${h.amount>0?'text-green-600':'text-red-600'}`}>{h.amount>0?'+':''}{h.amount}€</span></div>))}</div></div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================
// TÂCHES
// ==========================================
const TaskCell = ({ weekId, letter, label, isLocked, choreStatus, toggleChore, myLetter }: any) => {
  const isDone=choreStatus[weekId]?.[letter]||false;
  const canCheck=!isLocked&&myLetter===letter;
  return (
    <td className="p-4 text-center align-middle">
      <div className="flex flex-col items-center gap-2">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-sm ${isDone?'bg-green-100 text-green-700':'bg-gray-100 text-gray-500'}`}>{letter}</span>
        <button onClick={()=>canCheck&&toggleChore(weekId,letter)} disabled={!canCheck} className={`transition-transform active:scale-95 ${!canCheck&&!isDone?'opacity-20 cursor-not-allowed':''}`}>{isDone?<CheckSquare className="text-green-500" size={24}/>:(canCheck?<Square className="text-green-500 hover:fill-green-50" size={24}/>:<Square className="text-gray-200" size={24}/>)}</button>
      </div>
    </td>
  );
};

// ==========================================
// MODALS
// ==========================================
const EventModal = ({ isOpen, onClose, config, addEntry, newEvent, setNewEvent }: any) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  if(!isOpen)return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl space-y-6 relative animate-in zoom-in-95 duration-300">
        <button onClick={()=>onClose(false)} className="absolute top-6 right-6 text-gray-400 hover:text-black"><X size={24}/></button>
        <div className="text-center space-y-2"><div className="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4"><CalIcon size={32} style={{color:config.primaryColor}}/></div><h3 className="text-2xl font-cinzel font-bold">Nouvel Événement</h3></div>
        <div className="space-y-4">
          <div><label className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">Quoi ?</label><input value={newEvent.title} onChange={e=>setNewEvent({...newEvent,title:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 text-lg font-bold outline-none focus:ring-2" placeholder="Anniversaire..." autoFocus style={{'--tw-ring-color':config.primaryColor} as any}/></div>
          <div><label className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">Quand ?</label><input type="date" value={newEvent.date} onChange={e=>setNewEvent({...newEvent,date:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none cursor-pointer"/></div>
          <div onClick={()=>setNewEvent({...newEvent,isAllDay:!newEvent.isAllDay})} className="flex items-center justify-between p-4 rounded-xl border border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"><div className="flex items-center gap-3"><Clock size={20} className={newEvent.isAllDay?"text-gray-300":"text-black"}/><span className="font-bold text-sm">Toute la journée</span></div>{newEvent.isAllDay?<ToggleRight size={32} className="text-green-500"/>:<ToggleLeft size={32} className="text-gray-300"/>}</div>
          {!newEvent.isAllDay&&<div className="animate-in slide-in-from-top-2"><label className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">À quelle heure ?</label><input type="text" value={newEvent.time} onChange={e=>setNewEvent({...newEvent,time:e.target.value})} placeholder="Ex: 20h00" className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none font-bold text-lg"/></div>}
        </div>
        <button disabled={isSubmitting} onClick={async()=>{if(newEvent.title&&newEvent.date){setIsSubmitting(true);await addEntry('family_events',{title:newEvent.title,date:newEvent.date,time:newEvent.isAllDay?null:(newEvent.time||'')});setNewEvent({title:'',date:new Date().toISOString().split('T')[0],time:'',isAllDay:true});setIsSubmitting(false);onClose(false);}else{alert("Titre et date requis !");}}} className={`w-full py-4 rounded-xl font-black text-white uppercase tracking-widest shadow-lg transform active:scale-95 transition-all ${isSubmitting?'opacity-50':''}`} style={{backgroundColor:config.primaryColor}}>{isSubmitting?"Ajout...":"Ajouter au calendrier"}</button>
      </div>
    </div>
  );
};

const RecipeModal = ({ isOpen, onClose, config, currentRecipe, setCurrentRecipe, updateEntry, addEntry }: any) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [recipeUrl, setRecipeUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile=(e:any,callback:any)=>{
    const f=e.target.files[0];if(!f)return;setIsCompressing(true);const reader=new FileReader();
    reader.onload=(event:any)=>{const img=new Image();img.onload=()=>{const canvas=document.createElement('canvas');const MAX_WIDTH=800;const scale=MAX_WIDTH/img.width;if(scale<1){canvas.width=MAX_WIDTH;canvas.height=img.height*scale;}else{canvas.width=img.width;canvas.height=img.height;}const ctx=canvas.getContext('2d');if(ctx){ctx.drawImage(img,0,0,canvas.width,canvas.height);const compressedDataUrl=canvas.toDataURL('image/jpeg',0.7);callback(compressedDataUrl);setIsCompressing(false);}};img.src=event.target.result;};reader.readAsDataURL(f);
  };

  const importFromUrl = async () => {
    if(!recipeUrl.trim()) return;
    setIsImporting(true);
    try {
      // extractRecipeFromUrl retourne { title, chef, category, ingredients, steps }
      const parsed = await extractRecipeFromUrl(recipeUrl.trim());
      if(parsed && parsed.title) {
        setCurrentRecipe({...currentRecipe, ...parsed});
        setRecipeUrl('');
        alert('✅ Recette importée avec succès !');
      } else {
        alert('❌ Impossible d\'extraire la recette depuis cette URL. Vérifiez le lien.');
      }
    } catch { alert('❌ Erreur lors de l\'import. Vérifiez le lien.'); }
    setIsImporting(false);
  };

  if(!isOpen)return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-2xl rounded-[2.5rem] p-8 shadow-2xl space-y-6 relative animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
        <button onClick={()=>onClose(false)} className="absolute top-6 right-6 text-gray-400 hover:text-black"><X size={24}/></button>
        <div className="text-center"><div className="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4"><ChefHat size={32} style={{color:config.primaryColor}}/></div><h3 className="text-2xl font-cinzel font-bold">{currentRecipe.id?'Modifier la Recette':'Nouvelle Recette'}</h3></div>
        
        {/* IMPORT URL */}
        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
          <h4 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2"><Link size={12}/> Import Intelligent depuis URL</h4>
          <div className="flex gap-2">
            <input value={recipeUrl} onChange={e=>setRecipeUrl(e.target.value)} placeholder="https://www.marmiton.org/recettes/..." className="flex-1 p-3 rounded-xl border border-gray-200 bg-white text-sm font-bold outline-none"/>
            <button onClick={importFromUrl} disabled={isImporting||!recipeUrl} className="px-4 py-3 bg-purple-500 text-white rounded-xl hover:scale-105 transition-transform flex items-center gap-2 disabled:opacity-50">
              {isImporting?<Loader2 size={16} className="animate-spin"/>:<Brain size={16}/>}
              <span className="text-xs font-bold hidden sm:block">{isImporting?'Import...':'Importer'}</span>
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <input value={currentRecipe.title} onChange={e=>setCurrentRecipe({...currentRecipe,title:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 text-xl font-bold outline-none focus:ring-2" placeholder="Nom du plat..." autoFocus style={{'--tw-ring-color':config.primaryColor} as any}/>
          <div className="flex gap-4"><input value={currentRecipe.chef} onChange={e=>setCurrentRecipe({...currentRecipe,chef:e.target.value})} className="flex-1 p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none" placeholder="Chef (ex: Papa)"/><select value={currentRecipe.category} onChange={e=>setCurrentRecipe({...currentRecipe,category:e.target.value})} className="flex-1 p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none"><option value="entrée">Entrée</option><option value="plat">Plat</option><option value="dessert">Dessert</option><option value="autre">Autre</option></select></div>
          <div onClick={()=>!isCompressing&&fileRef.current?.click()} className="p-6 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 flex flex-col items-center text-gray-400 gap-2">{isCompressing?<div className="flex items-center gap-2 text-blue-500 font-bold"><Loader2 className="animate-spin"/>Compression...</div>:currentRecipe.image?<div className="flex items-center gap-2 text-green-600 font-bold"><CheckCircle2/>Photo ajoutée !</div>:<><Upload size={24}/><span>Ajouter une photo</span></>}</div>
          <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e=>handleFile(e,(b:string)=>setCurrentRecipe({...currentRecipe,image:b}))}/>
          <div className="grid md:grid-cols-2 gap-4"><textarea value={currentRecipe.ingredients} onChange={e=>setCurrentRecipe({...currentRecipe,ingredients:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none h-40" placeholder="Ingrédients (un par ligne)..."/><textarea value={currentRecipe.steps} onChange={e=>setCurrentRecipe({...currentRecipe,steps:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none h-40" placeholder="Étapes de préparation..."/></div>
        </div>
        <button disabled={isSubmitting||isCompressing} onClick={async()=>{if(currentRecipe.title){setIsSubmitting(true);const recipeToSave={...currentRecipe};try{if(recipeToSave.id){await updateEntry('family_recipes',recipeToSave.id,recipeToSave);}else{await addEntry('family_recipes',recipeToSave);}setIsSubmitting(false);onClose(false);}catch(e){alert("Image trop lourde ou erreur.");setIsSubmitting(false);}}else{alert("Il faut au moins un titre !");}}} className={`w-full py-4 rounded-xl font-black text-white uppercase tracking-widest shadow-lg transform active:scale-95 transition-all ${isSubmitting||isCompressing?'opacity-50 cursor-not-allowed':''}`} style={{backgroundColor:config.primaryColor}}>{isSubmitting?"Enregistrement...":(isCompressing?"Traitement image...":"Enregistrer la recette")}</button>
      </div>
    </div>
  );
};

// ==========================================
// NAVIGATION
// ==========================================
const SideMenu = ({ config, isOpen, close, setView, logout }: any) => {
  const [openUniverse, setOpenUniverse] = useState<string|null>('cuisine');

  const universes = [
    {
      id: 'cuisine',
      label: '🍳 CUISINE',
      subtitle: 'Le Ventre',
      links: [
        {id:'hub', label:'Le Tableau'},
        {id:'frigo', label:'Le Frigo'},
        {id:'recipes', label:'Les Recettes'},
        {id:'cooking', label:'Le Semainier'},
      ]
    },
    {
      id: 'intendance',
      label: '📋 INTENDANCE',
      subtitle: 'La Tête',
      links: [
        {id:'tasks', label:'Les Corvées'},
        {id:'wallet', label:'La Tirelire'},
        {id:'calendar', label:"L'Agenda"},
      ]
    },
    {
      id: 'systeme',
      label: '⚙️ SYSTÈME',
      subtitle: 'Les Rouages',
      links: [
        {id:'xsite', label:'XSite'},
        {id:'edit', label:'Administration'},
      ]
    },
  ];

  return (
    <div className={`fixed inset-0 z-[60] ${isOpen?'':'pointer-events-none'}`}>
      <div className={`absolute inset-0 bg-black/40 transition-opacity ${isOpen?'opacity-100':'opacity-0'}`} onClick={close}/>
      <div className={`absolute right-0 top-0 h-full w-80 transition-transform ${isOpen?'translate-x-0':'translate-x-full'} overflow-y-auto`} style={{backgroundColor:config.backgroundColor}}>
        {/* Header */}
        <div className="p-8 pb-4 flex items-center justify-between border-b border-black/5">
          <span className="font-cinzel font-black text-lg" style={{color:config.primaryColor}}>CHAUD.DEVANT</span>
          <button onClick={()=>close(false)} className="text-gray-400 hover:text-black"><X size={20}/></button>
        </div>

        {/* Accueil */}
        <div className="px-6 pt-4">
          <button onClick={()=>{setView('home');close(false);}} className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-black/5 transition-colors font-bold text-sm">
            <Home size={16} style={{color:config.primaryColor}}/> Accueil
          </button>
        </div>

        {/* 3 Univers */}
        <div className="px-4 py-2 space-y-1">
          {universes.map(u=>(
            <div key={u.id}>
              {/* En-tête univers */}
              <button
                onClick={()=>setOpenUniverse(openUniverse===u.id?null:u.id)}
                className="flex items-center justify-between w-full px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all hover:bg-black/5"
                style={{color: openUniverse===u.id ? config.primaryColor : '#9ca3af'}}
              >
                <div className="text-left">
                  <div>{u.label}</div>
                  <div className="text-[9px] font-bold opacity-50 normal-case tracking-normal mt-0.5">{u.subtitle}</div>
                </div>
                <ChevronRight size={14} className={`transition-transform ${openUniverse===u.id?'rotate-90':''}`}/>
              </button>

              {/* Liens du groupe */}
              {openUniverse===u.id&&(
                <div className="ml-4 pl-3 border-l-2 space-y-0.5 mb-2 animate-in slide-in-from-top-2" style={{borderColor:config.primaryColor+'40'}}>
                  {u.links.map(link=>(
                    <button
                      key={link.id}
                      onClick={()=>{setView(link.id);close(false);}}
                      className="block w-full text-left px-4 py-3 rounded-xl font-bold text-sm hover:bg-black/5 transition-colors text-gray-700 hover:text-black"
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Déconnexion */}
        <div className="px-6 mt-4 border-t border-black/5 pt-4">
          <button onClick={logout} className="flex items-center gap-3 w-full p-3 rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors font-bold text-sm">
            <LogIn size={16}/> Déconnexion
          </button>
        </div>
      </div>
    </div>
  );
};

const BottomNav = ({ config, view, setView }: any) => (
  <div className="md:hidden fixed bottom-0 w-full h-24 flex justify-around items-center rounded-t-[2.5rem] z-40 text-white/50 px-4 pb-4 shadow-xl" style={{backgroundColor:config.primaryColor}}>
    {[
      {id:'home',i:<Home size={22}/>},
      {id:'hub',i:<LayoutDashboard size={22}/>},
      {id:'tasks',i:<CheckSquare size={22}/>},
      {id:'recipes',i:<ChefHat size={22}/>},
      {id:'cooking',i:<CalIcon size={22}/>}
    ].map(b=><button key={b.id} onClick={()=>setView(b.id)} className={`p-2 ${view===b.id?'text-white -translate-y-2 bg-white/20 rounded-xl':''}`}>{b.i}</button>)}
  </div>
);

const HomeCard = ({ icon, title, label, onClick, color }: any) => (
  <div onClick={onClick} className="bg-white/70 backdrop-blur-md p-10 rounded-[3rem] cursor-pointer hover:scale-105 transition-transform shadow-lg border border-white/50 group">
    <div style={{color}} className="mb-6 group-hover:scale-110 transition-transform">{icon}</div>
    <h3 className="text-3xl font-cinzel font-bold mb-2">{title}</h3>
    <p className="text-[10px] font-bold tracking-widest opacity-50 uppercase flex items-center gap-2">{label}<ChevronRight size={14}/></p>
  </div>
);

// ==========================================
// ADMIN PANEL (RÉORGANISÉ)
// ==========================================
const AdminPanel = ({ config, save, add, del, upd, events, recipes, xsitePages, versions, restore, arch, chat, prompt, setP, load, hist, users }: any) => {
  const [tab, setTab] = useState('users');
  const [newUser, setNewUser] = useState({email:'',letter:'',name:''});
  const [localC, setLocalC] = useState(config);
  const [editingVersionId, setEditingVersionId] = useState<string|null>(null);
  const [tempVersionName, setTempVersionName] = useState('');
  const [currentXSite, setCurrentXSite] = useState({id:'',name:'',html:''});
  const [qrCodeUrl, setQrCodeUrl] = useState<string|null>(null);
  const [notif, setNotif] = useState<Partial<AppNotification>>({message:'',type:'info',repeat:'once',linkView:'',linkId:'',targets:['all']});
  const [notifMode, setNotifMode] = useState<'manual'|'ai'>('manual');
  const [aiNotif, setAiNotif] = useState({trigger:'',prompt:'',targets:['all'] as string[]});
  const [aiNotifLoading, setAiNotifLoading] = useState(false);
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [activeNotifs, setActiveNotifs] = useState<AppNotification[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(()=>{
    const q=query(collection(db,'notifications'),orderBy('createdAt','desc'));
    const unsub=onSnapshot(q,s=>setActiveNotifs(s.docs.map(d=>({id:d.id,...d.data()} as AppNotification))));
    return()=>unsub();
  },[]);

  useEffect(()=>{setLocalC(config);},[config]);

  const handleFile=(e:any,cb:any)=>{const f=e.target.files[0];if(f){const r=new FileReader();r.onload=()=>cb(r.result);r.readAsDataURL(f);}};
  const startEditVersion=(v:any)=>{setEditingVersionId(v.id);setTempVersionName(v.name);};
  const saveVersionName=(id:string)=>{upd('site_versions',id,{name:tempVersionName});setEditingVersionId(null);};
  const generateQrCode=(siteId:string)=>{const baseUrl=window.location.href.split('?')[0];const fullUrl=`${baseUrl}?id=${siteId}`;const apiUrl=`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(fullUrl)}`;setQrCodeUrl(apiUrl);};
  const copyCookingLink=()=>{const baseUrl=window.location.href.split('?')[0];const fullUrl=`${baseUrl}?view=cooking`;navigator.clipboard.writeText(fullUrl);alert("Lien copié !");};;

  const registerUser=async()=>{
    if(!newUser.email||!newUser.letter)return alert("Email et Lettre requis");
    await setDoc(doc(db,'site_users',newUser.email),{...newUser,createdAt:new Date().toISOString()});
    setNewUser({email:'',letter:'',name:''});
    alert("Utilisateur ajouté !");
  };

  const sendNotification=async()=>{
    if(!notif.message)return alert("Message vide");
    let scheduledISO=undefined;
    if(schedDate&&schedTime) scheduledISO=new Date(`${schedDate}T${schedTime}`).toISOString();
    await addDoc(collection(db,'notifications'),{...notif,targets:notif.targets?.length?notif.targets:['all'],scheduledFor:scheduledISO,createdAt:new Date().toISOString(),readBy:{}});
    setNotif({message:'',type:'info',repeat:'once',linkView:'',linkId:'',targets:['all']});
    setSchedDate('');setSchedTime('');
    alert("Notification envoyée/programmée !");
  };

  const sendAiNotification = async () => {
    if(!aiNotif.trigger||!aiNotif.prompt) return alert("Veuillez remplir le déclencheur et la description.");
    setAiNotifLoading(true);
    try {
      const { callGeminiDirect } = await import('./services/geminiService');

      // ── 1. Collecte TOUTES les données du site ──────────────────────────────
      const [frigoSnap, semainierSnap, hubSnap, eventSnap, walletSnap] = await Promise.all([
        getDocs(collection(db, 'frigo_items')),
        getDocs(collection(db, 'semainier_meals')),
        getDocs(collection(db, 'hub_items')),
        getDocs(collection(db, 'family_events')),
        getDocs(collection(db, 'wallet_entries')),
      ]);

      const frigoItems    = frigoSnap.docs.map(d => ({id:d.id, ...d.data()} as any));
      const semainierData = Object.fromEntries(semainierSnap.docs.map(d => [d.id, d.data()]));
      const hubData       = hubSnap.docs.map(d => ({id:d.id, ...d.data()} as any));
      const eventsData    = eventSnap.docs.map(d => ({id:d.id, ...d.data()} as any));

      // ── 2. Calcule les dates/semaine ───────────────────────────────────────
      const today     = new Date();
      const todayStr  = today.toISOString().split('T')[0];
      const dayName   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'][today.getDay()];
      const getWN = (d:Date) => { const t=new Date(d.valueOf());const dn=(d.getDay()+6)%7;t.setDate(t.getDate()-dn+3);const ft=t.valueOf();t.setMonth(0,1);if(t.getDay()!==4)t.setMonth(0,1+((4-t.getDay())+7)%7);return 1+Math.ceil((ft-t.valueOf())/604800000); };
      const weekKey   = `${today.getFullYear()}_W${String(getWN(today)).padStart(2,'0')}`;

      // ── 3. Résumés par domaine ─────────────────────────────────────────────
      // Frigo — avec état péremption
      const SHELF:Record<string,number> = {'Boucherie/Poisson':3,'Boulangerie':3,'Plat préparé':4,'Restes':4,'Primeur':7,'Frais & Crèmerie':10,'Épicerie Salée':90,'Épicerie Sucrée':90,'Boissons':90,'Surgelés':180,'Divers':14};
      const frigoLines = frigoItems.map((i:any) => {
        let expStr = i.expiryDate;
        if(!expStr && i.addedAt) { const d=new Date(i.addedAt); d.setDate(d.getDate()+(SHELF[i.category]??14)); expStr=d.toISOString().split('T')[0]; }
        const diff = expStr ? Math.ceil((new Date(expStr).getTime()-today.getTime())/(86400000)) : null;
        const etat = diff===null?'?': diff<0?'PÉRIMÉ': diff<=3?`⚠️ J-${diff}`:`J-${diff}`;
        return `${i.name} (${i.category}, ${etat})`;
      });
      const frigoResume = frigoLines.length ? frigoLines.join(', ') : 'frigo vide';

      // Courses
      const courses = hubData.filter((i:any)=>i.type==='shop').map((i:any)=>i.content).join(', ') || 'liste vide';

      // Semainier semaine courante
      const semResume = Object.entries(semainierData)
        .filter(([k]) => k.includes(weekKey))
        .map(([k,v]:any) => `${k.split('_')[0]} ${k.split('_')[1]}: ${v.platName}`)
        .join(', ') || 'aucun repas planifié';

      // Événements à venir
      const eventsResume = eventsData
        .filter((e:any) => e.date >= todayStr)
        .slice(0,5)
        .map((e:any) => `${e.title} le ${e.date?.split('T')[0]||'?'}`)
        .join(', ') || 'aucun événement';

      // Corvées — état détaillé par membre G/P/V
      const choresDetail = Object.entries(choreStatus as Record<string,any>)
        .slice(-3)
        .map(([wid, c]:any) => `${wid}: G=${c.G?'✅':'❌'} P=${c.P?'✅':'❌'} V=${c.V?'✅':'❌'}`)
        .join(' | ') || 'aucune info';

      // Recettes
      const recipesResume = (recipes||[]).slice(0,15).map((r:any)=>r.title).join(', ') || 'aucune';

      // ── 4. Construction de la liste des destinataires ciblés ───────────────
      const targetedUsers: any[] = aiNotif.targets.includes('all')
        ? users
        : users.filter((u:any) => aiNotif.targets.includes(u.id));

      // ── 5. Génération personnalisée par utilisateur ────────────────────────
      let sentCount = 0;

      const generateFor = async (targetUser: any | null) => {
        const uName   = targetUser?.name   || 'la famille';
        const uLetter = targetUser?.letter || '';
        const isGPV   = ['G','P','V'].includes(uLetter);

        // Détail corvées spécifique à ce membre
        let userChores = '';
        if(isGPV) {
          const pending = Object.entries(choreStatus as Record<string,any>)
            .map(([wid, c]:any) => c[uLetter] ? null : wid)
            .filter(Boolean);
          userChores = pending.length
            ? `${uName} a des corvées NON FAITES pour : ${pending.slice(0,3).join(', ')}`
            : `${uName} est à JOUR dans ses corvées.`;
        }

        const prompt = `Tu es le Majordome de la famille Frézouls sur l'application familiale "Chaud Devant".
Aujourd'hui : ${dayName} ${todayStr}.
Destinataire : ${uName}${uLetter ? ` (lettre=${uLetter}, membre actif G/P/V=${isGPV})` : ''}

══════════ DONNÉES RÉELLES DU SITE ══════════
📦 FRIGO (${frigoItems.length} produits) : ${frigoResume}
🛒 COURSES : ${courses}
🗓️  SEMAINIER (semaine ${weekKey}) : ${semResume}
📅 ÉVÉNEMENTS À VENIR : ${eventsResume}
🧹 CORVÉES : ${userChores || choresDetail}
📚 RECETTES : ${recipesResume}
═════════════════════════════════════════════

DÉCLENCHEUR ADMIN : "${aiNotif.trigger}"
CONSIGNES ADMIN : "${aiNotif.prompt}"

En te basant STRICTEMENT sur les données ci-dessus (cite des éléments réels !), génère UNE notification push courte (2-3 phrases max) pour ${uName}, en français, ton chaleureux et familier.
${isGPV ? `IMPORTANT : ${uName} est un membre actif (${uLetter}). Personnalise en mentionnant SES corvées spécifiques ou ses repas du semainier si pertinent.` : ''}
Réponds UNIQUEMENT avec le texte final de la notification, rien d'autre.`;

        const text = await callGeminiDirect([{role:'user', text:prompt}]);
        if(text?.trim()) {
          await addDoc(collection(db,'notifications'), {
            message: text.trim(),
            type: 'info',
            repeat: 'once',
            targets: targetUser ? [targetUser.id] : ['all'],
            createdAt: new Date().toISOString(),
            readBy: {},
            generatedByAI: true,
            trigger: aiNotif.trigger,
          });
          sentCount++;
        }
      };

      if(aiNotif.targets.includes('all') && targetedUsers.length === 0) {
        await generateFor(null); // Notif globale si aucun user ciblé
      } else if(aiNotif.targets.includes('all')) {
        // Personnalisée pour chaque membre
        for(const u of targetedUsers) await generateFor(u);
      } else {
        for(const u of targetedUsers) await generateFor(u);
      }

      setAiNotif({trigger:'',prompt:'',targets:['all']});
      alert(`✅ ${sentCount} notification(s) IA personnalisée(s) avec les données réelles du site !`);

    } catch(e:any) {
      console.error('sendAiNotification error:', e);
      alert('❌ Erreur : ' + (e.message || e));
    }
    setAiNotifLoading(false);
  };

  const sendEmailToAll=()=>{
    let recipients=notif.targets?.includes('all')?users.map((u:any)=>u.id).join(','):notif.targets?.join(',')||"";
    let linkText="";
    if(notif.linkView){const baseUrl=window.location.href.split('?')[0];let url=`${baseUrl}?view=${notif.linkView}`;if(notif.linkView==='xsite'&&notif.linkId)url+=`&id=${notif.linkId}`;else if(notif.linkId)url+=`&anchor=${notif.linkId}`;linkText=`%0A%0ALien direct : ${url}`;}
    const body=`Bonjour,%0A%0A${notif.message||"Nouvelle notification !"}${linkText}`;
    window.location.href=`mailto:?bcc=${recipients}&subject=Message%20Chaud%20Devant&body=${body}`;
  };

  const tabs = [
    {id:'users',l:'CONNEXIONS',i:<Users size={16}/>},
    {id:'notif',l:'NOTIFICATIONS',i:<Bell size={16}/>},
    {id:'history',l:'HISTORIQUE',i:<History size={16}/>},
    {id:'arch',l:'ARCHITECTE',i:<Sparkles size={16}/>},
    {id:'xsite',l:'XSITE',i:<Map size={16}/>},
    {id:'settings',l:'PARAMÈTRES',i:<Settings size={16}/>},
  ];

  return (
    <div className="bg-white/90 backdrop-blur-xl p-8 rounded-[3.5rem] shadow-2xl min-h-[700px] border border-black/5">
      <div className="flex gap-2 overflow-x-auto mb-10 pb-4 no-scrollbar">
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest whitespace-nowrap transition-all ${tab===t.id?'text-white scale-105 shadow-lg':'bg-gray-100 text-gray-400'}`} style={{backgroundColor:tab===t.id?config.primaryColor:''}}>{t.i}{t.l}</button>
        ))}
      </div>

      {/* USERS */}
      {tab==='users'&&(
        <div className="space-y-8 animate-in fade-in">
          <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>UTILISATEURS</h3>
          <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100">
            <h4 className="font-bold mb-4 text-xs uppercase tracking-widest text-gray-400">Ajouter un membre</h4>
            <div className="flex flex-col md:flex-row gap-4">
              <input value={newUser.email} onChange={e=>setNewUser({...newUser,email:e.target.value})} placeholder="Email" className="flex-1 p-3 rounded-xl border border-gray-200"/>
              <input value={newUser.name} onChange={e=>setNewUser({...newUser,name:e.target.value})} placeholder="Prénom" className="w-32 p-3 rounded-xl border border-gray-200"/>
              <input value={newUser.letter} onChange={e=>setNewUser({...newUser,letter:e.target.value})} placeholder="Lettre" className="w-20 p-3 rounded-xl border border-gray-200 text-center font-bold"/>
              <button onClick={registerUser} className="bg-black text-white p-3 rounded-xl"><Plus/></button>
            </div>
          </div>
          <div className="space-y-3">
            {users.map((u:any)=>(
              <div key={u.id} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center font-black text-gray-500">{u.letter}</div>
                  <div><div className="font-bold">{u.name||'Sans nom'}</div><div className="text-xs text-gray-400">{u.id}</div></div>
                </div>
                <div className="text-[10px] font-bold uppercase text-green-600 bg-green-50 px-2 py-1 rounded-md">{u.lastLogin?new Date(u.lastLogin).toLocaleDateString():'Jamais'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* NOTIF */}
      {tab==='notif'&&(
        <div className="space-y-8 animate-in fade-in">
          {/* Sélecteur de mode */}
          <div className="flex items-center gap-4">
            <h3 className="text-3xl font-cinzel font-bold flex-1" style={{color:config.primaryColor}}>NOTIFICATIONS</h3>
            <select value={notifMode} onChange={e=>setNotifMode(e.target.value as 'manual'|'ai')} className="p-3 rounded-2xl border-2 border-gray-200 font-black text-sm outline-none" style={{borderColor:notifMode==='ai'?config.primaryColor:''}}>
              <option value="manual">✍️ Manuelle</option>
              <option value="ai">🤖 Générée par IA</option>
            </select>
          </div>

          {/* MODE MANUEL */}
          {notifMode==='manual'&&(
            <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 space-y-4">
              <textarea value={notif.message} onChange={e=>setNotif({...notif,message:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200" placeholder="Message..."/>
              <div className="flex flex-wrap gap-2">
                <button onClick={()=>setNotif({...notif,targets:['all']})} className={`px-3 py-1 rounded-full text-xs font-bold ${notif.targets?.includes('all')?'bg-black text-white':'bg-gray-200 text-gray-500'}`}>TOUS</button>
                {users.map((u:any)=>(
                  <button key={u.id} onClick={()=>{const current=notif.targets?.includes('all')?[]:(notif.targets||[]);const newTargets=current.includes(u.id)?current.filter((t:string)=>t!==u.id):[...current,u.id];setNotif({...notif,targets:newTargets});}} className={`px-3 py-1 rounded-full text-xs font-bold ${notif.targets?.includes(u.id)?'bg-blue-500 text-white':'bg-gray-200 text-gray-500'}`}>{u.name||u.letter}</button>
                ))}
              </div>
              <div className="flex flex-col md:flex-row gap-4 items-center bg-white p-4 rounded-xl border border-gray-200">
                <div className="flex items-center gap-2 min-w-[200px]">
                  <CornerDownRight size={16} className="text-gray-400"/>
                  <select value={notif.linkView} onChange={e=>setNotif({...notif,linkView:e.target.value,linkId:''})} className="bg-transparent text-sm font-bold outline-none w-full">
                    <option value="">-- Page (Aucune) --</option>
                    {Object.keys(ORIGINAL_CONFIG.navigationLabels).map(key=>(<option key={key} value={key}>{ORIGINAL_CONFIG.navigationLabels[key as keyof typeof ORIGINAL_CONFIG.navigationLabels]}</option>))}
                  </select>
                </div>
                {notif.linkView==='xsite'?(<select value={notif.linkId} onChange={e=>setNotif({...notif,linkId:e.target.value})} className="flex-1 bg-transparent text-sm outline-none border-l pl-3 w-full"><option value="">-- Choisir un site --</option>{xsitePages.map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}</select>)
                :notif.linkView&&VIEW_ANCHORS[notif.linkView]?(<select value={notif.linkId} onChange={e=>setNotif({...notif,linkId:e.target.value})} className="flex-1 bg-transparent text-sm outline-none border-l pl-3 w-full"><option value="">-- Section --</option>{VIEW_ANCHORS[notif.linkView].map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select>)
                :(<div className="flex-1 text-xs text-gray-400 italic pl-3 border-l">Pas de sous-section</div>)}
              </div>
              <div className="flex flex-wrap gap-4">
                <select value={notif.type} onChange={e=>setNotif({...notif,type:e.target.value as any})} className="p-3 rounded-xl border border-gray-200"><option value="info">Info</option><option value="alert">Alerte</option><option value="fun">Fun</option></select>
                <select value={notif.repeat} onChange={e=>setNotif({...notif,repeat:e.target.value as any})} className="p-3 rounded-xl border border-gray-200"><option value="once">Une fois</option><option value="daily">Tous les jours</option><option value="monthly">Tous les mois</option></select>
                <div className="flex gap-2 items-center bg-white p-2 rounded-xl border border-gray-200"><CalendarClock size={16} className="text-gray-400"/><input type="date" value={schedDate} onChange={e=>setSchedDate(e.target.value)} className="text-xs font-bold outline-none"/><input type="time" value={schedTime} onChange={e=>setSchedTime(e.target.value)} className="text-xs font-bold outline-none"/></div>
                <button onClick={sendNotification} className="flex-1 bg-black text-white font-bold rounded-xl px-6">Envoyer Interne</button>
              </div>
              <button onClick={sendEmailToAll} className="w-full py-3 border-2 border-dashed border-gray-300 text-gray-500 font-bold rounded-xl hover:bg-gray-100 flex items-center justify-center gap-2"><Mail size={16}/>Envoyer par Mail</button>
            </div>
          )}

          {/* MODE IA */}
          {notifMode==='ai'&&(
            <div className="space-y-4 animate-in fade-in">
              <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 space-y-5">
                <div>
                  <label className="block font-black text-xs uppercase tracking-widest text-gray-400 mb-2">Déclencheur</label>
                  <input value={aiNotif.trigger} onChange={e=>setAiNotif(a=>({...a,trigger:e.target.value}))} placeholder="Ex : Toutes les semaines le lundi, Quand un produit est périmé..." className="w-full p-4 rounded-xl border border-gray-200 font-bold outline-none focus:border-black"/>
                </div>
                <div>
                  <label className="block font-black text-xs uppercase tracking-widest text-gray-400 mb-2">Description du message</label>
                  <textarea value={aiNotif.prompt} onChange={e=>setAiNotif(a=>({...a,prompt:e.target.value}))} placeholder="Ex : Ton chaleureux et bienveillant, rappel des corvées du weekend, encourage et félicite..." className="w-full p-4 rounded-xl border border-gray-200 outline-none h-28 resize-none"/>
                </div>
                <div>
                  <label className="block font-black text-xs uppercase tracking-widest text-gray-400 mb-2">Destinataires</label>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={()=>setAiNotif(a=>({...a,targets:['all']}))} className={`px-3 py-1 rounded-full text-xs font-bold ${aiNotif.targets.includes('all')?'bg-black text-white':'bg-gray-200 text-gray-500'}`}>TOUS</button>
                    {users.map((u:any)=>(
                      <button key={u.id} onClick={()=>{const c=aiNotif.targets.includes('all')?[]:aiNotif.targets;const t=c.includes(u.id)?c.filter((x:string)=>x!==u.id):[...c,u.id];setAiNotif(a=>({...a,targets:t}));}} className={`px-3 py-1 rounded-full text-xs font-bold ${aiNotif.targets.includes(u.id)?'bg-purple-500 text-white':'bg-gray-200 text-gray-500'}`}>{u.name||u.letter}</button>
                    ))}
                  </div>
                </div>
                <button onClick={sendAiNotification} disabled={aiNotifLoading} className="w-full py-4 text-white font-black rounded-2xl uppercase tracking-widest shadow-lg flex items-center justify-center gap-3 disabled:opacity-50 transition-all hover:scale-[1.01]" style={{backgroundColor:config.primaryColor}}>
                  {aiNotifLoading?<><Loader2 size={18} className="animate-spin"/>Génération en cours...</>:<><Sparkles size={18}/>Générer & Envoyer</>}
                </button>
              </div>
              <p className="text-xs text-gray-400 italic text-center">L'IA génère le message selon vos instructions et l'envoie directement aux destinataires.</p>
            </div>
          )}

          {/* LISTE DES NOTIFS ACTIVES */}
          <div className="space-y-2">
            {activeNotifs.map(n=>(
              <div key={n.id} className="flex justify-between items-center p-4 bg-white rounded-xl border border-gray-100">
                <div>
                  <div className="flex gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${n.type==='alert'?'bg-red-100 text-red-600':'bg-blue-100 text-blue-600'}`}>{n.type}</span>
                    {(n as any).generatedByAI&&<span className="text-[10px] font-bold bg-purple-100 text-purple-600 px-2 py-1 rounded flex items-center gap-1"><Sparkles size={8}/>IA</span>}
                    {n.scheduledFor&&<span className="text-[10px] font-bold bg-orange-100 text-orange-600 px-2 py-1 rounded flex items-center gap-1"><Clock size={10}/>{new Date(n.scheduledFor).toLocaleString()}</span>}
                  </div>
                  <span className="font-bold">{n.message}</span>
                </div>
                <button onClick={()=>deleteDoc(doc(db,'notifications',n.id))} className="text-red-400 hover:text-red-600"><Trash2 size={16}/></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HISTORIQUE */}
      {tab==='history'&&(
        <div className="space-y-6 animate-in fade-in">
          <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>HISTORIQUE</h3>
          <div className="space-y-3 h-96 overflow-y-auto">
            {versions.map((v:SiteVersion)=>(
              <div key={v.id} className="flex justify-between items-center p-5 bg-gray-50 rounded-2xl border border-gray-100 group">
                <div className="flex-1">
                  {editingVersionId===v.id?(
                    <div className="flex gap-2 mr-4">
                      <input value={tempVersionName} onChange={e=>setTempVersionName(e.target.value)} className="flex-1 p-2 rounded-lg border border-gray-300 text-sm" autoFocus/>
                      <button onClick={()=>saveVersionName(v.id)} className="p-2 bg-green-100 text-green-600 rounded-lg"><Save size={16}/></button>
                      <button onClick={()=>setEditingVersionId(null)} className="p-2 bg-red-100 text-red-600 rounded-lg"><X size={16}/></button>
                    </div>
                  ):(
                    <div>
                      <div className="font-bold flex items-center gap-2">{v.name}<button onClick={()=>startEditVersion(v)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-opacity"><Pencil size={12}/></button></div>
                      <div className="text-xs opacity-50">{new Date(v.date).toLocaleString()}</div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={()=>del('site_versions',v.id)} className="p-3 bg-white border border-red-100 text-red-400 rounded-xl hover:bg-red-500 hover:text-white transition-colors"><Trash2 size={18}/></button>
                  <button onClick={()=>restore(v)} className="p-3 bg-white border border-gray-200 rounded-xl hover:bg-black hover:text-white transition-colors"><RotateCcw size={18}/></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ARCHITECTE */}
      {tab==='arch'&&(
        <div className="space-y-6 animate-in fade-in">
          <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>ARCHITECTE IA</h3>
          <textarea value={prompt} onChange={e=>setP(e.target.value)} className="w-full p-6 rounded-3xl border border-gray-200 h-32 focus:ring-4 outline-none" placeholder="Ex: 'Met un thème sombre et doré'..."/>
          <button onClick={arch} disabled={load} className="w-full py-5 text-white rounded-2xl font-black uppercase shadow-xl" style={{backgroundColor:config.primaryColor}}>{load?<Loader2 className="animate-spin mx-auto"/>:"Transformer le design"}</button>
        </div>
      )}

      {/* XSITE */}
      {tab==='xsite'&&(
        <div className="space-y-8 animate-in fade-in">
          <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>GESTION XSITE</h3>
          {qrCodeUrl&&(
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4" onClick={()=>setQrCodeUrl(null)}>
              <div className="bg-white p-8 rounded-3xl text-center space-y-4 animate-in zoom-in-95" onClick={e=>e.stopPropagation()}>
                <h4 className="font-cinzel font-bold text-xl">Scannez ce code</h4>
                <img src={qrCodeUrl} alt="QR Code" className="mx-auto border-4 border-black rounded-xl"/>
                <button onClick={()=>setQrCodeUrl(null)} className="mt-4 px-6 py-2 bg-gray-100 rounded-xl font-bold">Fermer</button>
              </div>
            </div>
          )}
          <div className="space-y-3">
            {xsitePages.map((site:any)=>(
              <div key={site.id} className="flex justify-between items-center p-4 bg-gray-50 rounded-2xl border border-gray-200">
                <span className="font-bold text-lg">{site.name}</span>
                <div className="flex gap-2">
                  <button onClick={()=>generateQrCode(site.id)} className="p-2 bg-black text-white rounded-lg"><QrCode size={18}/></button>
                  <button onClick={()=>setCurrentXSite(site)} className="p-2 bg-blue-100 text-blue-600 rounded-lg"><Pencil size={18}/></button>
                  <button onClick={()=>del('xsite_pages',site.id)} className="p-2 bg-red-100 text-red-600 rounded-lg"><Trash2 size={18}/></button>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-white p-6 rounded-[2.5rem] shadow-lg border border-gray-100 space-y-4">
            <h4 className="text-sm font-bold uppercase tracking-widest text-gray-400">{currentXSite.id?'Modifier':'Nouveau'}</h4>
            <input value={currentXSite.name} onChange={e=>setCurrentXSite({...currentXSite,name:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 font-bold outline-none" placeholder="Nom du fichier"/>
            <textarea value={currentXSite.html} onChange={e=>setCurrentXSite({...currentXSite,html:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 font-mono text-xs h-48 outline-none" placeholder="HTML..."/>
            <button onClick={()=>{if(currentXSite.id){upd('xsite_pages',currentXSite.id,currentXSite);}else{add('xsite_pages',currentXSite);}setCurrentXSite({id:'',name:'',html:''}); }} className="w-full py-4 text-white font-bold rounded-xl uppercase shadow-lg" style={{backgroundColor:config.primaryColor}}>Sauvegarder</button>
          </div>
        </div>
      )}

      {/* PARAMÈTRES (Regroupement Accueil + Semainier + Maintenance) */}
      {tab==='settings'&&(
        <div className="space-y-8 animate-in fade-in">
          <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>PARAMÈTRES</h3>

          {/* MAINTENANCE / FUTUR — Sélection par page */}
          <div className="bg-black p-6 rounded-3xl space-y-5">
            <h4 className="font-black text-white uppercase tracking-widest text-sm flex items-center gap-2"><Lock size={16}/> MODE MAINTENANCE — PAR PAGE</h4>
            <p className="text-gray-400 text-sm leading-relaxed">
              Sélectionnez les pages à verrouiller. Les pages verrouillées affichent
              <span className="text-white font-bold mx-1">"Ici, débute le futur"</span>
              pour tous les membres sauf l'admin.
            </p>

            {/* Switch global rapide */}
            <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/10">
              <div>
                <span className="text-white font-bold text-sm">Tout verrouiller</span>
                <p className="text-gray-500 text-xs mt-0.5">Verrouille l'intégralité du site</p>
              </div>
              <button
                onClick={()=>{
                  const allLocked = Object.keys(ORIGINAL_CONFIG.navigationLabels).reduce((acc, key) => ({...acc, [key]: true}), {});
                  const newVal = {...localC, lockedPages: allLocked};
                  setLocalC(newVal);
                  save(newVal, false);
                }}
                className="px-4 py-2 bg-red-600 text-white rounded-xl font-bold text-xs hover:bg-red-500 transition-colors"
              >
                🔒 Tout fermer
              </button>
            </div>

            {/* Sélection granulaire par page */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Object.entries(ORIGINAL_CONFIG.navigationLabels).map(([key, label]) => {
                const isPageLocked = !!(localC.lockedPages as any)?.[key];
                return (
                  <button
                    key={key}
                    onClick={()=>{
                      const current = (localC.lockedPages as any) || {};
                      const newLockedPages = {...current, [key]: !isPageLocked};
                      const newVal = {...localC, lockedPages: newLockedPages};
                      setLocalC(newVal);
                      save(newVal, false);
                    }}
                    className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                      isPageLocked
                        ? 'bg-red-900/40 border-red-500/50 text-red-300'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                    }`}
                  >
                    <span className="font-bold text-xs uppercase tracking-wide">{label}</span>
                    <span className="text-sm">{isPageLocked ? '🔒' : '🔓'}</span>
                  </button>
                );
              })}
            </div>

            {/* Bouton tout déverrouiller */}
            <button
              onClick={()=>{
                const newVal = {...localC, lockedPages: {}};
                setLocalC(newVal);
                save(newVal, false);
              }}
              className="w-full py-3 border border-white/20 text-gray-400 font-bold rounded-xl hover:bg-white/5 transition-colors text-xs uppercase tracking-widest"
            >
              🔓 Tout déverrouiller
            </button>
          </div>

          {/* PAGE ACCUEIL */}
          <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 space-y-4">
            <h4 className="font-black text-gray-600 uppercase tracking-widest text-sm flex items-center gap-2"><Home size={16}/> PAGE D'ACCUEIL</h4>
            <input value={localC.welcomeTitle} onChange={e=>setLocalC({...localC,welcomeTitle:e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200" placeholder="Titre principal"/>
            <textarea value={localC.welcomeText} onChange={e=>setLocalC({...localC,welcomeText:e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200 h-24" placeholder="Texte de bienvenue"/>
            <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e=>handleFile(e,(b:string)=>setLocalC({...localC,welcomeImage:b}))}/>
            <div onClick={()=>fileRef.current?.click()} className="p-4 border-2 border-dashed rounded-2xl text-center cursor-pointer text-xs uppercase font-bold text-gray-400">Changer la photo</div>
            <textarea value={localC.homeHtml} onChange={e=>setLocalC({...localC,homeHtml:e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200 h-32 font-mono text-xs" placeholder="Code HTML/Widget pour l'accueil (Optionnel)"/>
          </div>

          {/* SEMAINIER */}
          <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 space-y-4">
            <h4 className="font-black text-gray-600 uppercase tracking-widest text-sm flex items-center gap-2"><Code size={16}/> CODE SEMAINIER</h4>
            <textarea value={localC.cookingHtml} onChange={e=>setLocalC({...localC,cookingHtml:e.target.value})} className="w-full p-6 rounded-3xl border border-gray-200 h-48 font-mono text-xs text-gray-600" placeholder="Code HTML iframe..."/>
            <button onClick={copyCookingLink} className="flex items-center gap-2 px-6 py-3 bg-black text-white rounded-xl font-bold hover:scale-105 transition-transform"><Copy size={16}/> Copier le lien Semainier</button>
          </div>

          <button onClick={()=>save(localC,true)} className="w-full py-5 text-white rounded-2xl font-black shadow-xl uppercase" style={{backgroundColor:config.primaryColor}}>Sauvegarder tous les paramètres</button>
        </div>
      )}
    </div>
  );
};

// ==========================================
// SEMAINIER (intégré, données Firebase)
// ==========================================
const JOURS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const REPAS = ["Midi","Soir"];
const PARTICIPANTS = ["Olivier","Lætitia","Gabriel","Valentin","Pauline"];

function getWeekNumber(date:Date){const t=new Date(date.valueOf());const dn=(date.getDay()+6)%7;t.setDate(t.getDate()-dn+3);const ft=t.valueOf();t.setMonth(0,1);if(t.getDay()!==4)t.setMonth(0,1+((4-t.getDay())+7)%7);return 1+Math.ceil((ft-t.valueOf())/604800000);}
function getMondayOfWeek(offset:number){const now=new Date();now.setHours(0,0,0,0);const day=now.getDay()||7;const mon=new Date(now);mon.setDate(now.getDate()-day+1+(offset*7));return mon;}
function getWeekId(offset:number){const mon=getMondayOfWeek(offset);return `${mon.getFullYear()}_W${String(getWeekNumber(mon)).padStart(2,'0')}`;}
function makeKey(day:string,meal:string,offset:number){return `${day}_${meal}_${getWeekId(offset)}`;}

const SemainierView = ({config, recipes}:{config:SiteConfig, recipes:Recipe[]}) => {
  const [data, setData] = useState<Record<string,any>>({});
  const [weekOffset, setWeekOffset] = useState(0);
  const [modal, setModal] = useState<{day:string,meal:string}|null>(null);
  const [form, setForm] = useState({platName:'',participants:[] as string[],recetteLink:'',notes:''});
  const [toast, setToast] = useState('');
  const [dragOver, setDragOver] = useState<string|null>(null);

  const showToast = (msg:string) => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  // Favoris = toutes les recettes Firebase
  const favs = recipes.map(r=>({platName:r.title, recetteLink:'', notes:'', recipeId:r.id}));

  // Charge depuis Firebase collection semainier_meals
  useEffect(()=>{
    const unsub = onSnapshot(collection(db,'semainier_meals'), snap => {
      const d:Record<string,any> = {};
      snap.docs.forEach(doc=>{ d[doc.id] = doc.data(); });
      setData(d);
    });
    return ()=>unsub();
  },[]);

  const saveEntry = async (key:string, entry:any) => {
    await setDoc(doc(db,'semainier_meals',key), entry);
  };

  const deleteEntry = async (key:string) => {
    await deleteDoc(doc(db,'semainier_meals',key));
  };

  const monday = getMondayOfWeek(weekOffset);
  const weekLabel = `Semaine ${getWeekNumber(monday)} — du ${monday.toLocaleDateString('fr-FR')}`;

  const openModal = (day:string, meal:string) => {
    const key = makeKey(day,meal,weekOffset);
    const existing = data[key];
    setForm({
      platName: existing?.platName||'',
      participants: existing?.participants||[],
      recetteLink: existing?.recetteLink||'',
      notes: existing?.notes||'',
    });
    setModal({day,meal});
  };

  const saveModal = async () => {
    if(!modal||!form.platName.trim()){showToast('⚠️ Nom du plat requis');return;}
    if(!form.participants.length){showToast('⚠️ Sélectionnez au moins un participant');return;}
    const key = makeKey(modal.day,modal.meal,weekOffset);
    await saveEntry(key,{platName:form.platName,participants:form.participants,recetteLink:form.recetteLink,notes:form.notes});
    setModal(null);
    showToast('🍽️ Repas enregistré !');
  };

  const deleteMeal = async (day:string, meal:string, e:React.MouseEvent) => {
    e.stopPropagation();
    await deleteEntry(makeKey(day,meal,weekOffset));
    showToast('🗑️ Repas supprimé');
  };

  const loadFav = (fav:any) => {
    setForm(f=>({...f,platName:fav.platName,recetteLink:fav.recetteLink||'',notes:fav.notes||''}));
  };

  const toggleParticipant = (p:string) => {
    setForm(f=>({...f,participants:f.participants.includes(p)?f.participants.filter(x=>x!==p):[...f.participants,p]}));
  };

  // Drag & drop : déposer un favori directement dans une case
  const handleDrop = async (e:React.DragEvent, day:string, meal:string) => {
    e.preventDefault();
    setDragOver(null);
    const platName = e.dataTransfer.getData('platName');
    const recetteLink = e.dataTransfer.getData('recetteLink');
    if(!platName) return;
    const key = makeKey(day,meal,weekOffset);
    // Utilise les participants déjà en place ou tous par défaut
    const existing = data[key];
    const participants = existing?.participants?.length ? existing.participants : PARTICIPANTS;
    await saveEntry(key,{platName,participants,recetteLink,notes:''});
    showToast(`✅ "${platName}" placé en ${meal} ${day}`);
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      {toast&&<div className="fixed top-24 right-6 bg-black text-white px-5 py-3 rounded-2xl font-bold shadow-2xl z-[300] animate-in slide-in-from-right text-sm">{toast}</div>}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-3xl font-cinzel font-black" style={{color:config.primaryColor}}>SEMAINIER</h2>
        <div className="flex items-center gap-3">
          <button onClick={()=>setWeekOffset(w=>w-1)} className="w-10 h-10 rounded-full border-2 flex items-center justify-center font-black text-lg hover:bg-black hover:text-white transition-colors" style={{borderColor:config.primaryColor,color:config.primaryColor}}>‹</button>
          <span className="font-bold text-sm text-gray-600 min-w-[200px] text-center">{weekLabel}</span>
          <button onClick={()=>setWeekOffset(w=>w+1)} className="w-10 h-10 rounded-full border-2 flex items-center justify-center font-black text-lg hover:bg-black hover:text-white transition-colors" style={{borderColor:config.primaryColor,color:config.primaryColor}}>›</button>
        </div>
      </div>

      {/* Tableau — hauteur uniforme = taille de la plus grande cellule */}
      <div className="overflow-x-auto rounded-2xl shadow-lg border border-gray-100">
        <table className="w-full border-collapse min-w-[700px] table-fixed">
          <thead>
            <tr style={{backgroundColor:config.primaryColor}}>
              <th className="p-3 text-white font-black text-xs uppercase w-20">Repas</th>
              {JOURS.map(j=><th key={j} className="p-3 text-white font-black text-xs uppercase">{j}</th>)}
            </tr>
          </thead>
          <tbody>
            {REPAS.map(meal=>(
              <tr key={meal} className="border-t border-gray-100">
                <td className="p-3 font-black text-xs uppercase text-center align-middle" style={{backgroundColor:config.primaryColor+'22',color:config.primaryColor}}>{meal}</td>
                {JOURS.map(day=>{
                  const key=makeKey(day,meal,weekOffset);
                  const entry=data[key];
                  const isDragTarget = dragOver===key;
                  return(
                    <td
                      key={day}
                      onClick={()=>openModal(day,meal)}
                      onDragOver={e=>{e.preventDefault();setDragOver(key);}}
                      onDragLeave={()=>setDragOver(null)}
                      onDrop={e=>handleDrop(e,day,meal)}
                      className={`p-2 relative cursor-pointer transition-all group align-top ${isDragTarget?'bg-blue-50 ring-2 ring-blue-400 ring-inset':'hover:bg-gray-50'}`}
                    >
                      {entry?(
                        <div className="p-2 rounded-xl min-h-[80px] flex flex-col gap-1" style={{backgroundColor:config.primaryColor+'15',borderLeft:`3px solid ${config.primaryColor}`}}>
                          <button onClick={e=>deleteMeal(day,meal,e)} className="absolute top-1 left-1 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">×</button>
                          <div className="font-bold text-sm text-gray-800 leading-tight pr-5">{entry.platName}</div>
                          <div className="text-[10px] text-gray-500">{entry.participants?.join(', ')}</div>
                          {entry.recetteLink&&<a href={entry.recetteLink} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px]" style={{backgroundColor:config.primaryColor,color:'white'}}>🔗</a>}
                        </div>
                      ):(
                        <div className={`min-h-[80px] flex items-center justify-center text-xs italic transition-colors ${isDragTarget?'text-blue-400 font-bold':'text-gray-300'}`}>
                          {isDragTarget?'Déposer ici':'+ ajouter'}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Favoris (recettes) — glissables vers les cases */}
      {favs.length>0&&(
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h4 className="font-black text-xs uppercase tracking-widest text-gray-400 mb-1 flex items-center gap-2"><Star size={14}/> RECETTES — glissez vers une case</h4>
          <p className="text-[10px] text-gray-400 mb-4 italic">Sur mobile : appuyez pour ouvrir la case, puis choisissez dans la liste</p>
          <div className="flex flex-wrap gap-2">
            {favs.map((f,i)=>(
              <div
                key={i}
                draggable
                onDragStart={e=>{e.dataTransfer.setData('platName',f.platName);e.dataTransfer.setData('recetteLink',f.recetteLink||'');}}
                className="flex items-center gap-1 bg-gray-50 rounded-xl px-3 py-2 border border-gray-200 cursor-grab active:cursor-grabbing hover:border-black hover:shadow-sm transition-all select-none"
                title="Glissez vers une case du tableau"
              >
                <span className="font-bold text-xs text-gray-700">{f.platName}</span>
                <span className="text-gray-300 ml-1">⠿</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal ajout repas */}
      {modal&&(
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={()=>setModal(null)}>
          <div className="bg-white rounded-[2.5rem] p-8 w-full max-w-md shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-cinzel font-black" style={{color:config.primaryColor}}>{modal.meal} — {modal.day}</h3>
              <button onClick={()=>setModal(null)} className="text-gray-400 hover:text-black"><X/></button>
            </div>

            {/* Sélecteur recettes/favoris */}
            {favs.length>0&&(
              <select onChange={e=>{if(e.target.value!=='')loadFav(favs[parseInt(e.target.value)]);}} className="w-full p-3 rounded-xl border border-gray-200 bg-gray-50 text-sm font-bold outline-none" defaultValue="">
                <option value="">⭐ Choisir une recette...</option>
                {favs.map((f,i)=><option key={i} value={i}>{f.platName}</option>)}
              </select>
            )}

            <input value={form.platName} onChange={e=>setForm(f=>({...f,platName:e.target.value}))} placeholder="Nom du plat *" className="w-full p-4 rounded-xl border-2 border-gray-200 font-bold outline-none focus:border-black" autoFocus/>
            <input value={form.recetteLink} onChange={e=>setForm(f=>({...f,recetteLink:e.target.value}))} placeholder="Lien recette (optionnel)" className="w-full p-3 rounded-xl border border-gray-200 text-sm outline-none"/>
            <textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Notes (optionnel)" className="w-full p-3 rounded-xl border border-gray-200 text-sm outline-none h-20"/>

            <div>
              <p className="font-black text-xs uppercase text-gray-400 mb-2">Participants *</p>
              <div className="grid grid-cols-2 gap-2">
                {PARTICIPANTS.map(p=>(
                  <button key={p} type="button" onClick={()=>toggleParticipant(p)} className={`p-3 rounded-xl font-bold text-sm transition-all border-2 ${form.participants.includes(p)?'text-white border-transparent':'bg-gray-50 text-gray-600 border-gray-200'}`} style={form.participants.includes(p)?{backgroundColor:config.primaryColor,borderColor:config.primaryColor}:{}}>{p}</button>
                ))}
              </div>
            </div>

            <button onClick={saveModal} className="w-full py-4 text-white font-black rounded-2xl uppercase tracking-widest shadow-lg hover:scale-[1.02] transition-transform" style={{backgroundColor:config.primaryColor}}>Enregistrer</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================
// PAGE MAINTENANCE (par page)
// ==========================================
const MaintenancePage = ({ pageName }: { pageName?: string }) => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] py-20 bg-black rounded-[3rem]">
    <div className="text-center space-y-8 animate-in fade-in duration-1000 px-8">
      <div className="w-20 h-20 mx-auto border border-white/10 rounded-full flex items-center justify-center">
        <Flame className="text-white/30" size={36}/>
      </div>
      <div>
        <h1 className="text-4xl md:text-6xl font-black text-white tracking-[0.3em] uppercase" style={{fontFamily:'Georgia, serif'}}>
          Ici,
        </h1>
        <h2 className="text-2xl md:text-4xl font-black text-white/50 tracking-widest uppercase mt-2" style={{fontFamily:'Georgia, serif'}}>
          débute le futur.
        </h2>
        {pageName && (
          <p className="mt-6 text-white/20 text-xs uppercase tracking-[0.4em]">{pageName} — bientôt disponible</p>
        )}
      </div>
      <div className="w-12 h-px bg-white/10 mx-auto"/>
      <p className="text-white/15 text-xs uppercase tracking-[0.3em]">Revenez bientôt</p>
    </div>
  </div>
);

// ==========================================
// APP COMPONENT
// ==========================================
const App: React.FC = () => {
  const [user, setUser] = useState<User|null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [config, setConfig] = useState<SiteConfig>(ORIGINAL_CONFIG);
  const [xsitePages, setXsitePages] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [versions, setVersions] = useState<SiteVersion[]>([]);
  const [choreStatus, setChoreStatus] = useState<Record<string,any>>({});
  const [favorites, setFavorites] = useState<string[]>([]);
  const [siteUsers, setSiteUsers] = useState<any[]>([]);
  const [usersMapping, setUsersMapping] = useState<Record<string,string>>({});
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [selectedXSite, setSelectedXSite] = useState<any>(null);
  const [newEvent, setNewEvent] = useState({title:'',date:new Date().toISOString().split('T')[0],time:'',isAllDay:true});
  const defaultRecipeState = {id:'',title:'',chef:'',ingredients:'',steps:'',category:'plat',image:''};
  const [currentRecipe, setCurrentRecipe] = useState<any>(defaultRecipeState);
  const [currentView, setCurrentView] = useState<string>('home');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [chatHistory, setChatHistory] = useState<{role:string,text:string}[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // AUTH
  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async u=>{
      setUser(u);setIsInitializing(false);
      if(u&&u.email){
        try{
          await setDoc(doc(db,'site_users',u.email),{lastLogin:new Date().toISOString(),email:u.email},{merge:true});
          const prefsDoc=await getDoc(doc(db,'user_prefs',u.email));
          if(prefsDoc.exists()) setFavorites(prefsDoc.data().favorites||[]);
        }catch(e){console.error("Err sync user",e);}
      }
    });
    return()=>unsub();
  },[]);

  const isAuthorized = user&&user.email&&(siteUsers.find(u=>u.id===user.email)||user.email===ADMIN_EMAIL);
  const myLetter = user&&user.email?(usersMapping[user.email]||user.email.charAt(0).toUpperCase()):null;

  // CHARGEMENT DONNÉES
  useEffect(()=>{
    if(!user) return;
    const ignoreError=(err:any)=>{console.log("Info:",err.code);};
    const unsubC=onSnapshot(doc(db,'site_config','main'),d=>{if(d.exists())setConfig(d.data() as SiteConfig);},ignoreError);
    const unsubX=onSnapshot(query(collection(db,'xsite_pages'),orderBy('timestamp','desc')),s=>setXsitePages(s.docs.map(d=>({...d.data(),id:d.id}))),ignoreError);
    const unsubR=onSnapshot(collection(db,'family_recipes'),s=>setRecipes(s.docs.map(d=>({...d.data(),id:d.id} as Recipe))),ignoreError);
    const unsubE=onSnapshot(collection(db,'family_events'),s=>{const raw=s.docs.map(d=>({...d.data(),id:d.id} as FamilyEvent));raw.sort((a,b)=>a.date.localeCompare(b.date));setEvents(raw);},ignoreError);
    const unsubV=onSnapshot(query(collection(db,'site_versions'),orderBy('date','desc')),s=>setVersions(s.docs.map(d=>({...d.data(),id:d.id} as SiteVersion))),ignoreError);
    const unsubT=onSnapshot(collection(db,'chores_status'),s=>{const status:Record<string,any>={};s.docs.forEach(d=>{status[d.id]=d.data();});setChoreStatus(status);},ignoreError);
    const unsubU=onSnapshot(collection(db,'site_users'),s=>{const users=s.docs.map(d=>({id:d.id,...d.data()}));setSiteUsers(users);const newMap:Record<string,string>={};users.forEach((u:any)=>{if(u.letter)newMap[u.id]=u.letter;});setUsersMapping(newMap);},ignoreError);
    const unsubN=onSnapshot(query(collection(db,'notifications'),orderBy('createdAt','desc')),s=>{
      const raw=s.docs.map(d=>({id:d.id,...d.data()} as AppNotification));
      const visible=raw.filter(n=>{
        if(!user.email)return false;
        if(n.targets&&!n.targets.includes('all')&&!n.targets.includes(user.email))return false;
        if(n.scheduledFor&&new Date()<new Date(n.scheduledFor))return false;
        const readDate=n.readBy[user.email];
        if(!readDate)return true;
        const lastRead=new Date(readDate);const now=new Date();
        if(n.repeat==='once')return false;
        if(n.repeat==='daily')return lastRead.getDate()!==now.getDate();
        if(n.repeat==='monthly')return lastRead.getMonth()!==now.getMonth();
        return true;
      });
      setNotifications(visible);
    },ignoreError);
    return()=>{unsubC();unsubX();unsubR();unsubE();unsubV();unsubT();unsubU();unsubN();};
  },[user]);

  // DEEP LINKING
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const targetView=params.get('view');
    if(targetView){
      setCurrentView(targetView);
      if(targetView==='xsite'){const siteId=params.get('id');if(siteId&&xsitePages.length>0){const found=xsitePages.find(p=>p.id===siteId);if(found)setSelectedXSite(found);}}
      const anchorId=params.get('anchor');
      if(anchorId){setTimeout(()=>{const el=document.getElementById(anchorId);if(el){el.scrollIntoView({behavior:'smooth',block:'start'});el.classList.add('ring-4','ring-offset-2','ring-orange-400','transition-all','duration-1000');setTimeout(()=>el.classList.remove('ring-4','ring-offset-2','ring-orange-400'),2000);}},800);}
      window.history.replaceState({},document.title,window.location.pathname);
    }
  },[xsitePages]);

  // ACTIONS
  const handleLogin=async()=>{try{await signInWithPopup(auth,googleProvider);}catch(e){alert("Erreur Auth");}};
  const handleLogout=()=>{signOut(auth);setCurrentView('home');};
  const saveConfig=async(c:SiteConfig,saveHistory=false)=>{try{await setDoc(doc(db,'site_config','main'),c);setConfig(c);if(saveHistory)await addDoc(collection(db,'site_versions'),{name:'Sauvegarde',date:new Date().toISOString(),config:c});}catch(e){console.error(e);}};
  const restoreVersion=(v:SiteVersion)=>{if(confirm(`Restaurer la version "${v.name}" ?`))saveConfig(v.config,false);};
  const addEntry=async(col:string,data:any)=>{try{const{id,...cleanData}=data;await addDoc(collection(db,col),{...cleanData,timestamp:serverTimestamp()});}catch(e){alert("Erreur ajout");}};
  const updateEntry=async(col:string,id:string,data:any)=>{try{const{id:_,...c}=data;await setDoc(doc(db,col,id),{...c,timestamp:serverTimestamp()},{merge:true});alert("Sauvegardé");}catch(e){alert("Erreur");}};
  const deleteItem=async(col:string,id:string)=>{if(!id){alert("Erreur ID");return;}if(confirm("Supprimer ?")){try{await deleteDoc(doc(db,col,id));}catch(e){alert("Erreur suppression");}}};
  const toggleChore=async(weekId:string,letter:string)=>{try{const current=choreStatus[weekId]?.[letter]||false;await setDoc(doc(db,'chores_status',weekId),{[letter]:!current},{merge:true});}catch(e){console.error("Erreur coche",e);}};
  const toggleFavorite=async(siteId:string)=>{if(!user||!user.email)return;const ref=doc(db,'user_prefs',user.email);try{if(favorites.includes(siteId)){await setDoc(ref,{favorites:arrayRemove(siteId)},{merge:true});setFavorites(prev=>prev.filter(id=>id!==siteId));}else{await setDoc(ref,{favorites:arrayUnion(siteId)},{merge:true});setFavorites(prev=>[...prev,siteId]);}}catch(e){console.error("Error toggle fav",e);}};
  const openEditRecipe=(recipe:any)=>{const ingredientsStr=Array.isArray(recipe.ingredients)?recipe.ingredients.join('\n'):recipe.ingredients;const stepsStr=recipe.steps||recipe.instructions||'';setCurrentRecipe({...recipe,ingredients:ingredientsStr,steps:stepsStr});setIsRecipeModalOpen(true);};
  const handleArchitect=async()=>{if(!aiPrompt.trim())return;setIsAiLoading(true);const n=await askAIArchitect(aiPrompt,config);if(n)await saveConfig({...config,...n},true);setIsAiLoading(false);};
  const handleChat=async()=>{if(!aiPrompt.trim())return;const h=[...chatHistory,{role:'user',text:aiPrompt}];setChatHistory(h);setAiPrompt('');setIsAiLoading(true);const r=await askAIChat(h);setChatHistory([...h,{role:'model',text:r}]);setIsAiLoading(false);};
  const addRecipeToHub=async(recipe:any)=>{if(!confirm(`Ajouter les ingrédients de "${recipe.title}" à la liste de courses ?`))return;const ingredients=Array.isArray(recipe.ingredients)?recipe.ingredients:(typeof recipe.ingredients==='string'?recipe.ingredients.split('\n'):[]);let count=0;for(let ing of ingredients){const cleanIng=ing.trim();if(cleanIng){await addDoc(collection(db,'hub_items'),{type:'shop',content:cleanIng,category:categorizeShoppingItem(cleanIng),author:'Chef',createdAt:new Date().toISOString(),done:false});count++;}}alert(`${count} ingrédients ajoutés au Tableau !`);};
  const markNotifRead=async(notifId:string)=>{if(!user?.email)return;await setDoc(doc(db,'notifications',notifId),{readBy:{[user.email]:new Date().toISOString()}},{merge:true});};
  const handleNotificationClick=(n:AppNotification)=>{markNotifRead(n.id);if(n.linkView){setCurrentView(n.linkView);if(n.linkView==='xsite'&&n.linkId){const site=xsitePages.find(p=>p.id===n.linkId);if(site)setSelectedXSite(site);}else if(n.linkId){setTimeout(()=>{const el=document.getElementById(n.linkId!);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});},500);}}setIsNotifOpen(false);};

  // Helper : vérifie si une page est verrouillée pour les non-admins
  const isPageLocked = (viewKey: string): boolean => {
    if(!user || user.email === ADMIN_EMAIL) return false;
    const lockedPages = (config as any).lockedPages || {};
    return !!lockedPages[viewKey];
  };

  // --- ÉCRANS SPÉCIAUX ---
  if(isInitializing) return <div className="min-h-screen flex items-center justify-center bg-[#f5ede7]"><Loader2 className="w-12 h-12 animate-spin text-[#a85c48]"/></div>;

  if(!user) return (
    <div className="fixed inset-0 flex flex-col items-center justify-center p-6 bg-[#f5ede7]">
      <Background color={ORIGINAL_CONFIG.primaryColor}/>
      <div className="z-10 text-center space-y-8 animate-in fade-in zoom-in duration-700">
        <div className="mx-auto w-24 h-24 rounded-[2.5rem] flex items-center justify-center shadow-xl bg-[#a85c48]"><Sparkles className="text-white" size={48}/></div>
        <h1 className="text-4xl font-cinzel font-black tracking-widest text-[#a85c48]">CHAUD DEVANT</h1>
        <button onClick={handleLogin} className="bg-white text-black font-black py-4 px-8 rounded-2xl shadow-xl flex items-center gap-3 hover:scale-105 transition-transform"><LogIn size={24}/>CONNEXION GOOGLE</button>
      </div>
    </div>
  );

  if(!isAuthorized) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-red-50 text-center space-y-8">
      <ShieldAlert className="text-red-500 w-20 h-20"/>
      <h2 className="text-3xl font-bold text-red-800 font-cinzel">ACCÈS RESTREINT</h2>
      <p>Contactez Gabriel pour valider votre compte.</p>
      <button onClick={handleLogout} className="px-6 py-4 bg-red-500 text-white font-bold rounded-2xl">Déconnexion</button>
    </div>
  );

  // PAGE MAINTENANCE (sauf admin)
  // NOTE: le verrouillage global est géré page par page via isPageLocked()
  // (l'ancien config.isLocked global est remplacé par config.lockedPages)

  return (
    <div className="min-h-screen pb-24 md:pb-0 transition-colors duration-700" style={{backgroundColor:config.backgroundColor,fontFamily:config.fontFamily}}>
      <Background color={config.primaryColor}/>

      {/* NOTIFICATIONS PANEL */}
      {isNotifOpen&&(
        <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm flex justify-end" onClick={()=>setIsNotifOpen(false)}>
          <div className="w-full max-w-sm bg-white h-full p-6 animate-in slide-in-from-right shadow-2xl" onClick={e=>e.stopPropagation()}>
            <h3 className="text-2xl font-cinzel font-bold mb-6 flex items-center gap-2"><Bell className="text-orange-500"/>Notifications</h3>
            <div className="space-y-4">
              {notifications.length===0&&<p className="text-gray-400 italic text-center">Aucune nouvelle notification.</p>}
              {notifications.map(n=>(
                <div key={n.id} className={`p-4 rounded-xl border-l-4 ${n.type==='alert'?'bg-red-50 border-red-500':'bg-blue-50 border-blue-500'}`}>
                  <p className="font-bold text-gray-800 mb-2">{n.message}</p>
                  {n.linkView&&<button onClick={()=>handleNotificationClick(n)} className="w-full py-2 bg-black text-white rounded-lg text-xs font-bold uppercase mb-2">Aller voir</button>}
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-[10px] uppercase text-gray-400">{new Date(n.createdAt).toLocaleDateString()}</span>
                    <button onClick={()=>markNotifRead(n.id)} className="text-xs font-bold px-3 py-1 bg-white rounded-lg shadow-sm border hover:bg-gray-50">Marquer lu</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VIEWER XSITE IMMERSIF */}
      {currentView==='xsite'&&selectedXSite&&(
        <div className="fixed inset-0 z-[100] bg-white flex flex-col animate-in fade-in slide-in-from-bottom-10">
          <div className="h-16 border-b flex items-center justify-between px-4 bg-white shadow-sm z-10">
            <button onClick={()=>setSelectedXSite(null)} className="flex items-center gap-2 text-sm font-bold text-gray-600 hover:text-black"><ArrowLeft size={20}/>Retour</button>
            <span className="font-cinzel font-bold text-lg truncate">{selectedXSite.name}</span>
            <button onClick={()=>toggleFavorite(selectedXSite.id)} className="p-2 transition-transform active:scale-95"><Star size={24} className={favorites.includes(selectedXSite.id)?"fill-yellow-400 text-yellow-400":"text-gray-300"}/></button>
          </div>
          <iframe srcDoc={selectedXSite.html} className="flex-1 w-full border-none" title={selectedXSite.name} sandbox="allow-scripts allow-same-origin"/>
        </div>
      )}

      {/* NAVBAR */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-xl border-b border-black/5 z-50 h-20 px-6 flex items-center justify-between">
        <div onClick={()=>setCurrentView('home')} className="flex items-center gap-3 cursor-pointer">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{backgroundColor:config.primaryColor}}><Home className="text-white" size={20}/></div>
          <span className="font-cinzel font-black text-xl hidden md:block" style={{color:config.primaryColor}}>CHAUD.DEVANT</span>
        </div>
        <div className="flex gap-4 items-center">
          <div className="hidden md:flex gap-6">
            {['home','hub','frigo','xsite','recipes','cooking','calendar','tasks','wallet'].map(v=>(
              <button key={v} onClick={()=>setCurrentView(v)} className="text-xs font-black tracking-widest opacity-40 hover:opacity-100 uppercase" style={{color:currentView===v?config.primaryColor:'inherit'}}>{config.navigationLabels[v as keyof typeof config.navigationLabels]||v}</button>
            ))}
          </div>
          <button onClick={()=>setIsNotifOpen(true)} className="relative p-2 text-gray-400 hover:text-black transition-colors">
            <Bell size={24}/>
            {notifications.length>0&&<span className="absolute top-1 right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse"/>}
          </button>
          <button className="md:hidden" onClick={()=>setIsMenuOpen(true)} style={{color:config.primaryColor}}><Menu size={28}/></button>
          <button className="hidden md:block" onClick={()=>setIsMenuOpen(true)} style={{color:config.primaryColor}}><Menu size={20}/></button>
        </div>
      </nav>

      <SideMenu config={config} isOpen={isMenuOpen} close={()=>setIsMenuOpen(false)} setView={setCurrentView} logout={handleLogout}/>
      <BottomNav config={config} view={currentView} setView={setCurrentView}/>

      <main className="max-w-7xl mx-auto px-6 pt-28 pb-32 relative z-10">

        {/* ACCUEIL */}
        {currentView==='home'&&(
          <div className="space-y-16 animate-in fade-in duration-1000" id="top">
            <section className="relative h-[60vh] rounded-[3rem] overflow-hidden shadow-2xl group">
              <img src={config.welcomeImage} className="w-full h-full object-cover transition-transform duration-[10s] group-hover:scale-110"/>
              <div className="absolute inset-0 bg-black/40 flex flex-col justify-end p-10">
                <h1 className="text-5xl md:text-8xl font-cinzel font-black text-white leading-none">{config.welcomeTitle}</h1>
                <p className="text-xl text-white/90 italic mt-4">{config.welcomeText}</p>
                <button onClick={()=>setCurrentView('hub')} className="mt-8 bg-white text-black px-8 py-4 rounded-xl font-bold uppercase tracking-widest shadow-xl flex items-center gap-3 w-fit hover:scale-105 transition-transform"><LayoutDashboard/>Ouvrir le Tableau</button>
              </div>
            </section>
            {config.homeHtml&&(
              <section id="home-widget" className="bg-white/50 rounded-[3rem] overflow-hidden shadow-xl mb-8">
                <iframe srcDoc={config.homeHtml} className="w-full h-[500px]" sandbox="allow-scripts" title="Home Widget"/>
              </section>
            )}
            <div className="grid md:grid-cols-3 gap-8" id="home-shortcuts">
              <HomeCard icon={<LayoutDashboard size={40}/>} title="Tableau" label="Courses & Notes" onClick={()=>setCurrentView('hub')} color={config.primaryColor}/>
              <HomeCard icon={<Refrigerator size={40}/>} title="Frigo" label="Inventaire & Anti-gaspi" onClick={()=>setCurrentView('frigo')} color={config.primaryColor}/>
              <HomeCard icon={<ChefHat size={40}/>} title="Recettes" label="Nos petits plats" onClick={()=>setCurrentView('recipes')} color={config.primaryColor}/>
            </div>
          </div>
        )}

        {/* HUB */}
        {currentView==='hub'&&(isPageLocked('hub')?<MaintenancePage pageName="Le Tableau"/>:<HubView user={user} config={config} usersMapping={usersMapping}/>)}

        {/* FRIGO */}
        {currentView==='frigo'&&(
          isPageLocked('frigo') ? <MaintenancePage pageName="Frigo"/> : (
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-4">
              <h2 className="text-5xl font-cinzel font-black text-center" style={{color:config.primaryColor}}>MON FRIGO</h2>
              <p className="text-gray-500 italic text-sm">Inventaire intelligent & gestion anti-gaspi</p>
            </div>
            <FrigoView user={user} config={config}/>
          </div>
          )
        )}

        {/* PORTE-MONNAIE */}
        {currentView==='wallet'&&(isPageLocked('wallet')?<MaintenancePage pageName="Porte-Monnaie"/>:<WalletView user={user} config={config}/>)}

        {/* TÂCHES */}
        {currentView==='tasks'&&(isPageLocked('tasks') ? <MaintenancePage pageName="Tâches"/> : (
          <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-8" id="tasks-table">
            <div className="text-center space-y-4">
              <h2 className="text-5xl font-cinzel font-black" style={{color:config.primaryColor}}>TÂCHES MÉNAGÈRES</h2>
              <p className="text-gray-500 font-serif italic">{myLetter?`Salut ${myLetter==='G'?'Gabriel':myLetter==='P'?'Pauline':'Valentin'}, à l'attaque !`:"Connecte-toi avec ton compte perso."}</p>
            </div>
            <div className="bg-white/90 backdrop-blur-xl rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/50">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left" style={{backgroundColor:config.primaryColor+'15'}}>
                      <th className="p-4 font-black uppercase text-xs tracking-widest text-gray-500 w-24">Weekend</th>
                      <th className="p-4 font-black uppercase text-xs tracking-widest text-center" style={{color:config.primaryColor}}>Aspi Haut</th>
                      <th className="p-4 font-black uppercase text-xs tracking-widest text-center" style={{color:config.primaryColor}}>Aspi Bas</th>
                      <th className="p-4 font-black uppercase text-xs tracking-widest text-center" style={{color:config.primaryColor}}>Lav/Douche</th>
                      <th className="p-4 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {getMonthWeekends().map((week,i)=>{
                      const rowStatus=choreStatus[week.id]||{};
                      const isRowComplete=rowStatus.G&&rowStatus.P&&rowStatus.V;
                      const now=new Date();
                      const isLocked=week.fullDate.getTime()>(now.getTime()+86400000*6);
                      return(
                        <tr key={i} className={`transition-colors ${isRowComplete?'bg-green-50/50':'hover:bg-white/50'}`}>
                          <td className="p-4 font-mono font-bold text-gray-700 whitespace-nowrap text-sm">{week.dateStr}{isLocked&&<span className="ml-2 text-xs text-gray-300">🔒</span>}</td>
                          <TaskCell weekId={week.id} letter={week.haut} label="Aspi Haut" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter}/>
                          <TaskCell weekId={week.id} letter={week.bas} label="Aspi Bas" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter}/>
                          <TaskCell weekId={week.id} letter={week.douche} label="Lavabo" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter}/>
                          <td className="p-4 text-center">{isRowComplete&&<CheckCircle2 className="text-green-500 mx-auto animate-bounce"/>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="p-6 bg-gray-50 text-center text-xs text-gray-400 uppercase tracking-widest border-t border-gray-100">G = Gabriel • P = Pauline • V = Valentin</div>
            </div>
          </div>
        ))}

        {/* CALENDRIER */}
        {currentView==='calendar'&&(isPageLocked('calendar') ? <MaintenancePage pageName="Calendrier"/> : (
          <div className="max-w-3xl mx-auto space-y-10" id="calendar-view">
            <div className="flex flex-col items-center gap-6">
              <h2 className="text-5xl font-cinzel font-black" style={{color:config.primaryColor}}>CALENDRIER</h2>
              <button onClick={()=>setIsEventModalOpen(true)} className="bg-black text-white px-8 py-4 rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform flex items-center gap-3 shadow-xl" style={{backgroundColor:config.primaryColor}}><Plus size={20}/>Ajouter un événement</button>
            </div>
            <EventModal isOpen={isEventModalOpen} onClose={setIsEventModalOpen} config={config} addEntry={addEntry} newEvent={newEvent} setNewEvent={setNewEvent}/>
            <div className="space-y-4">
              {events.map(ev=>{
                const cleanDate=ev.date.split('T')[0];const dateObj=new Date(cleanDate);
                return(
                  <div key={ev.id} className="flex items-center gap-6 p-6 bg-white rounded-2xl shadow-sm border border-black/5 hover:shadow-md transition-shadow group">
                    <div className="text-center w-16">
                      <div className="font-bold text-xl leading-none" style={{color:config.primaryColor}}>{dateObj.getDate()}</div>
                      <div className="text-[10px] uppercase font-bold text-gray-400">{dateObj.toLocaleString('fr-FR',{month:'short'})}</div>
                    </div>
                    <div className="flex-1 border-l pl-6 border-gray-100">
                      <div className="font-bold text-lg font-cinzel text-gray-800">{ev.title}</div>
                      {ev.time&&<div className="text-xs text-gray-400 flex items-center mt-1"><Clock size={10} className="mr-1"/>{ev.time}</div>}
                    </div>
                    <button onClick={()=>deleteItem('family_events',ev.id)} className="opacity-0 group-hover:opacity-100 p-2 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"><Trash2 size={16}/></button>
                  </div>
                );
              })}
              {events.length===0&&<div className="text-center text-gray-400 py-10 italic">Rien de prévu pour le moment...</div>}
            </div>
          </div>
        ))}

        {/* XSITE */}
        {currentView==='xsite'&&(isPageLocked('xsite') ? <MaintenancePage pageName="XSite"/> : (
          <div className="space-y-10">
            {!selectedXSite&&(
              (user.email===ADMIN_EMAIL||favorites.length>0)?(
                <>
                  <div className="flex flex-col items-center gap-6">
                    <h2 className="text-5xl font-cinzel font-black text-center" style={{color:config.primaryColor}}>MES FAVORIS</h2>
                    <p className="text-gray-400 italic">Vos accès rapides XSite</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                    {xsitePages.filter(p=>user.email===ADMIN_EMAIL?true:favorites.includes(p.id)).map(site=>(
                      <div key={site.id} onClick={()=>setSelectedXSite(site)} className="bg-white p-8 rounded-[2rem] shadow-lg border border-gray-100 cursor-pointer hover:scale-105 transition-transform group">
                        <div className="flex items-center justify-between mb-4">
                          <div className="p-3 bg-gray-50 rounded-full group-hover:bg-black group-hover:text-white transition-colors"><Map size={24}/></div>
                          <ArrowLeft size={20} className="rotate-180 opacity-0 group-hover:opacity-50"/>
                        </div>
                        <h3 className="text-xl font-bold uppercase tracking-wide">{site.name}</h3>
                        <div className="mt-2 text-xs text-gray-400">Cliquez pour ouvrir</div>
                      </div>
                    ))}
                    {xsitePages.filter(p=>favorites.includes(p.id)).length===0&&user.email!==ADMIN_EMAIL&&(
                      <p className="col-span-full text-center text-gray-400 italic">Aucun favori. Scannez un QR code pour commencer.</p>
                    )}
                  </div>
                </>
              ):(
                <div className="flex flex-col items-center justify-center py-20 space-y-6 text-center">
                  <div className="p-8 bg-gray-100 rounded-[3rem] animate-pulse"><QrCode size={64} className="text-gray-400"/></div>
                  <h2 className="text-3xl font-cinzel font-bold text-gray-400">ACCÈS VERROUILLÉ</h2>
                  <p className="text-gray-400 max-w-md">Scannez un QR code pour accéder à un mini-site.</p>
                </div>
              )
            )}
          </div>
        ))}

        {/* RECETTES */}
        {currentView==='recipes'&&(isPageLocked('recipes') ? <MaintenancePage pageName="Recettes"/> : (
          <div className="space-y-10" id="recipes-list">
            <div className="flex flex-col items-center gap-6">
              <h2 className="text-5xl font-cinzel font-black text-center" style={{color:config.primaryColor}}>RECETTES</h2>
              <button onClick={()=>{setCurrentRecipe(defaultRecipeState);setIsRecipeModalOpen(true);}} className="bg-black text-white px-8 py-4 rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform flex items-center gap-3 shadow-xl" style={{backgroundColor:config.primaryColor}}><Plus size={20}/>Ajouter une recette</button>
            </div>
            <RecipeModal isOpen={isRecipeModalOpen} onClose={setIsRecipeModalOpen} config={config} currentRecipe={currentRecipe} setCurrentRecipe={setCurrentRecipe} updateEntry={updateEntry} addEntry={addEntry}/>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {recipes.length===0&&<p className="text-center col-span-full opacity-50">Aucune recette pour le moment.</p>}
              {recipes.map((r:any)=>(
                <div key={r.id} className="relative group">
                  <div className="absolute top-4 right-4 z-20 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={()=>addRecipeToHub(r)} className="p-2 bg-white/90 rounded-full shadow-md text-orange-500 hover:scale-110 transition-transform"><ShoppingBag size={16}/></button>
                    <button onClick={()=>openEditRecipe(r)} className="p-2 bg-white/90 rounded-full shadow-md text-blue-500 hover:scale-110 transition-transform"><Pencil size={16}/></button>
                    <button onClick={()=>deleteItem('family_recipes',r.id)} className="p-2 bg-white/90 rounded-full shadow-md text-red-500 hover:scale-110 transition-transform"><Trash2 size={16}/></button>
                  </div>
                  <RecipeCard recipe={{...r,ingredients:typeof r.ingredients==='string'?r.ingredients.split('\n').filter((i:string)=>i.trim()!==''):r.ingredients,instructions:r.steps||r.instructions}}/>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* SEMAINIER — intégré directement dans l'app */}
        {currentView==='cooking'&&(isPageLocked('cooking') ? <MaintenancePage pageName="Semainier"/> : (
          <div className="space-y-0 animate-in fade-in" id="cooking-frame">
            <div className="bg-white/90 rounded-[3rem] overflow-hidden shadow-xl border border-black/5" style={{minHeight:'800px'}}>
              <SemainierView config={config} recipes={recipes}/>
            </div>
          </div>
        ))}

        {/* ADMIN */}
        {currentView==='edit'&&(
          user.email===ADMIN_EMAIL?(
            <AdminPanel
              config={config} save={saveConfig}
              add={addEntry} del={deleteItem} upd={updateEntry}
              events={events} versions={versions} restore={restoreVersion}
              recipes={recipes} xsitePages={xsitePages}
              arch={handleArchitect} chat={handleChat}
              prompt={aiPrompt} setP={setAiPrompt} load={isAiLoading} hist={chatHistory}
              users={siteUsers} choreStatus={choreStatus}
            />
          ):(
            <div className="max-w-md mx-auto bg-white/80 p-10 rounded-[3rem] text-center space-y-8 shadow-xl mt-20">
              <ShieldAlert className="mx-auto text-red-500" size={48}/>
              <h2 className="text-3xl font-cinzel font-bold text-red-500">ACCÈS REFUSÉ</h2>
              <p className="text-gray-500">Seul l'administrateur peut accéder à cette zone.</p>
            </div>
          )
        )}
      </main>
    </div>
  );
};

export default App;
