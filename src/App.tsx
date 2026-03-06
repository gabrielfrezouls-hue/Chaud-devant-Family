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
  Refrigerator, Scan, Camera, AlertTriangle, Bot, Flame, Info, Package, Barcode, Brain, Cloud
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
  frigo:[{label:'Inventaire',id:'frigo-list'}],
  wishlist:[{label:'Mes listes',id:'wishlist-top'}]
};

// --- CONFIG PAR DÉFAUT ---
const ORIGINAL_CONFIG: SiteConfig = {
  primaryColor: '#a85c48', backgroundColor: '#f5ede7', fontFamily: 'Montserrat',
  welcomeTitle: 'CHAUD DEVANT',
  welcomeText: "Bienvenue dans l'espace sacré de notre famille.",
  welcomeImage: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?q=80&w=2070&auto=format&fit=crop',
  navigationLabels: { home:'ACCUEIL', hub:'LE TABLEAU', xsite:'XSITE', cooking:'SEMAINIER', recipes:'RECETTES', calendar:'CALENDRIER', tasks:'TÂCHES', wallet:'PORTE-MONNAIE', frigo:'FRIGO', wishlist:'WISHLISTS' },
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
// COMPOSANT FRIGO + CELLIER
// ==========================================
const CELLIER_CATEGORIES = ['Épicerie Salée','Épicerie Sucrée','Boissons','Hygiène & Beauté','Entretien Maison','Divers'];
const FRIGO_CATEGORIES   = ['Boucherie/Poisson','Boulangerie','Plat préparé','Restes','Primeur','Frais & Crèmerie','Surgelés'];

type GaugeLevel = 'plein'|'moitie'|'vide';
const GAUGE_CONFIG: Record<GaugeLevel,{label:string,color:string,bg:string,fill:number}> = {
  plein:  {label:'Plein',   color:'text-green-700',  bg:'bg-green-50',   fill:100},
  moitie: {label:'Moitié',  color:'text-orange-600', bg:'bg-orange-50',  fill:50},
  vide:   {label:'Vide',    color:'text-red-600',    bg:'bg-red-50',     fill:5},
};

const GaugeBar = ({level, onClick}:{level:GaugeLevel, onClick:()=>void}) => {
  const cfg = GAUGE_CONFIG[level];
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${cfg.bg} ${cfg.color} transition-all hover:scale-105`} title="Cliquer pour changer">
      <div className="w-12 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{width:`${cfg.fill}%`, backgroundColor: level==='plein'?'#16a34a':level==='moitie'?'#ea580c':'#dc2626'}}/>
      </div>
      <span className="text-[10px] font-black uppercase tracking-wide">{cfg.label}</span>
    </button>
  );
};

const FrigoView = ({ user, config, onNavigate, isPremium, onShowFreemium }: { user:User, config:SiteConfig, onNavigate?:(v:string)=>void, isPremium?:boolean, onShowFreemium?:()=>void }) => {
  const [items, setItems] = useState<FrigoItem[]>([]);
  const [frigotab, setFrigotab] = useState<'frigo'|'cellier'>('frigo');
  const [newItem, setNewItem] = useState({ name:'', quantity:1, unit:'pcs', expiryDate:'', hasExpiry:true });
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const barcodePhotoRef = useRef<HTMLInputElement>(null);
  // Hub quick-add depuis le Frigo
  const [hubQuickName, setHubQuickName] = useState('');
  const [showHubQuick, setShowHubQuick] = useState(false);
  const [hubQuickLoading, setHubQuickLoading] = useState(false);

  const addToHubQuick = async () => {
    if(!hubQuickName.trim()) return;
    setHubQuickLoading(true);
    try {
      const cat = categorizeShoppingItem(hubQuickName.trim());
      await addDoc(collection(db,'hub_items'),{
        content: hubQuickName.trim(), type:'shop', category: cat,
        createdAt: new Date().toISOString(), userId: user.email
      });
      setHubQuickName(''); setShowHubQuick(false);
    } catch { /* ignore */ }
    setHubQuickLoading(false);
  };

  // NETTOYAGE AUTO-GASPI : supprime les articles périmés depuis plus de 5 jours
  useEffect(() => {
    const cleanup = async () => {
      const snap = await getDocs(collection(db,'frigo_items'));
      const today = new Date(); today.setHours(0,0,0,0);
      const cutoff = new Date(today); cutoff.setDate(cutoff.getDate()-5);
      for(const d of snap.docs) {
        const item = d.data() as any;
        // Ne pas supprimer les articles Cellier (pas de péremption)
        if(CELLIER_CATEGORIES.includes(item.category) && !item.expiryDate) continue;
        let expStr = item.expiryDate;
        if(!expStr && item.addedAt) {
          const SHELF:Record<string,number> = {'Boucherie/Poisson':3,'Boulangerie':3,'Plat préparé':4,'Restes':4,'Primeur':7,'Frais & Crèmerie':10,'Épicerie Salée':90,'Épicerie Sucrée':90,'Boissons':90,'Surgelés':90,'Divers':14};
          const base = new Date(item.addedAt); base.setDate(base.getDate()+(SHELF[item.category]??14));
          expStr = base.toISOString().split('T')[0];
        }
        if(expStr) {
          const [y,m,d2]=expStr.split('-').map(Number);
          const exp=new Date(y,m-1,d2);
          if(exp<=cutoff) { await deleteDoc(doc(db,'frigo_items',d.id)); }
        }
      }
    };
    cleanup();
  },[]);

  const handleBarcodePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if(!file) return; e.target.value='';
    setIsLoading(true); setScanMsg('⏳ Lecture du code-barre...');
    try {
      const { readBarcodeFromImage } = await import('./services/geminiService');
      const code = await readBarcodeFromImage(file);
      if(code) { setScanMsg(`✅ Code : ${code} — Recherche...`); await fetchProductByBarcode(code); }
      else { setScanMsg('❌ Code-barre illisible.'); setIsLoading(false); }
    } catch { setScanMsg('❌ Erreur lecture.'); setIsLoading(false); }
  };

  useEffect(() => {
    const q = query(collection(db,'frigo_items'), orderBy('addedAt','desc'));
    const unsub = onSnapshot(q, s => setItems(s.docs.map(d=>({id:d.id,...d.data()} as FrigoItem))));
    return ()=>unsub();
  },[]);

  const SHELF_LIFE: Record<string,number> = {
    'Boucherie/Poisson':3,'Boulangerie':3,'Plat préparé':4,'Restes':4,'Primeur':7,
    'Frais & Crèmerie':10,'Épicerie Salée':90,'Épicerie Sucrée':90,'Boissons':90,'Surgelés':90,'Divers':14,
  };

  const addItem = async () => {
    if(!newItem.name.trim()) return;
    setIsLoading(true); setScanMsg('⏳ Classification IA...');
    try {
      const { classifyFrigoItem } = await import('./services/geminiService');
      const aiResult = await classifyFrigoItem(newItem.name.trim());
      const category = aiResult?.category || categorizeShoppingItem(newItem.name);
      const isCellier = CELLIER_CATEGORIES.includes(category);
      // Pour le cellier, pas de date de péremption (sauf si forcée)
      const expiryDate = (!isCellier && newItem.hasExpiry) ? (newItem.expiryDate || aiResult?.expiryDate || '') : '';
      await addDoc(collection(db,'frigo_items'),{
        ...newItem, name:newItem.name.trim(), category, expiryDate,
        gaugeLevel: isCellier ? 'plein' : undefined,
        addedAt: new Date().toISOString()
      });
      setScanMsg(`✅ "${newItem.name.trim()}" → ${category}${expiryDate?` · péremption ${expiryDate}`:isCellier?' · Cellier':''}`);
      setNewItem({name:'',quantity:1,unit:'pcs',expiryDate:'',hasExpiry:true});
      setTimeout(()=>setScanMsg(''),4000);
    } catch {
      await addDoc(collection(db,'frigo_items'),{
        ...newItem, name:newItem.name.trim(),
        category:categorizeShoppingItem(newItem.name), addedAt:new Date().toISOString()
      });
      setNewItem({name:'',quantity:1,unit:'pcs',expiryDate:'',hasExpiry:true}); setScanMsg('');
    }
    setIsLoading(false);
  };

  const fetchProductByBarcode = async (code:string) => {
    setIsLoading(true); setScanMsg('');
    try {
      const resp = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
      const data = await resp.json();
      if(data.status===1&&data.product) {
        const p=data.product; const name=p.product_name_fr||p.product_name||'Produit inconnu';
        const category=categorizeShoppingItem(name);
        const isCellier=CELLIER_CATEGORIES.includes(category);
        await addDoc(collection(db,'frigo_items'),{
          name, category, quantity:1, unit:'pcs', barcode:code,
          gaugeLevel:isCellier?'plein':undefined, addedAt:new Date().toISOString()
        });
        setScanMsg(`✅ "${name}" (${category}) ajouté !`);
      } else setScanMsg('❌ Produit introuvable.');
    } catch { setScanMsg('❌ Erreur réseau.'); }
    setIsLoading(false); setBarcodeInput('');
  };

  const handlePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file=e.target.files?.[0]; if(!file) return; e.target.value='';
    // Vérification quota scan IA (5/mois pour gratuits)
    if(!isPremium) {
      const monthKey = new Date().toISOString().slice(0,7); // "2025-01"
      const scanKeyDoc = await getDoc(doc(db,'user_prefs',user.email||'?'));
      const scanData = scanKeyDoc.exists() ? scanKeyDoc.data() : {};
      const scansThisMonth = scanData[`scans_${monthKey}`] || 0;
      if(scansThisMonth >= 5) {
        if(onShowFreemium) onShowFreemium();
        return;
      }
      await setDoc(doc(db,'user_prefs',user.email||'?'),{[`scans_${monthKey}`]:scansThisMonth+1},{merge:true});
    }
    setIsLoading(true); setScanMsg('⏳ Analyse IA...');
    try {
      const result = await scanProductImage(file);
      if(result?.name) {
        const isCellier=CELLIER_CATEGORIES.includes(result.category||'');
        await addDoc(collection(db,'frigo_items'),{
          name:result.name, category:result.category||categorizeShoppingItem(result.name),
          expiryDate:isCellier?'':(result.expiryDate||''),
          gaugeLevel:isCellier?'plein':undefined, quantity:1, unit:'pcs', addedAt:new Date().toISOString()
        });
        setScanMsg(`✅ "${result.name}" (${result.category})`);
      } else setScanMsg('❌ Non reconnu.');
    } catch { setScanMsg('❌ Erreur analyse.'); }
    setIsLoading(false);
  };

  const deleteItem = async (id:string) => { await deleteDoc(doc(db,'frigo_items',id)); };

  const cycleGauge = async (item: any) => {
    const order:GaugeLevel[] = ['plein','moitie','vide','plein'];
    const next = order[order.indexOf(item.gaugeLevel||'plein')+1] || 'plein';
    await updateDoc(doc(db,'frigo_items',item.id),{gaugeLevel:next});
  };

  const estimateExpiryFromCategory = (addedAt:string, category:string) => {
    const days=SHELF_LIFE[category]??14; const d=new Date(addedAt);
    d.setDate(d.getDate()+days); return d.toISOString().split('T')[0];
  };

  const getExpiryStatus = (item: FrigoItem) => {
    if(CELLIER_CATEGORIES.includes(item.category) && !item.expiryDate) return null;
    let expStr=item.expiryDate;
    if(!expStr&&item.addedAt) expStr=estimateExpiryFromCategory(item.addedAt,item.category);
    if(!expStr) return null;
    const [y,m,d]=expStr.split('-').map(Number); const exp=new Date(y,m-1,d);
    const now=new Date(); now.setHours(0,0,0,0);
    const diff=Math.ceil((exp.getTime()-now.getTime())/(86400000));
    if(diff<0) return {label:'Périmé',color:'bg-red-100 text-red-700',icon:'🔴'};
    if(diff<=3) return {label:`J-${diff}`,color:'bg-orange-100 text-orange-700',icon:'🟠'};
    return {label:`J-${diff}`,color:'bg-green-100 text-green-700',icon:'🟢'};
  };

  const frigoItems   = items.filter(i=>FRIGO_CATEGORIES.includes(i.category));
  const cellierItems = items.filter(i=>CELLIER_CATEGORIES.includes(i.category));
  const expiringSoon = frigoItems.filter(i=>{ const s=getExpiryStatus(i); return s&&(s.icon==='🔴'||s.icon==='🟠'); });
  const isCellierInput = CELLIER_CATEGORIES.includes(categorizeShoppingItem(newItem.name));

  return (
    <div className="space-y-6 pb-24 animate-in fade-in" id="frigo-list">

      {/* MODALE AJOUT RAPIDE AU HUB */}
      {showHubQuick&&(
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={()=>setShowHubQuick(false)}>
          <div className="bg-white rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm shadow-2xl space-y-4" onClick={e=>e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
            <h3 className="font-black text-xl flex items-center gap-2"><ShoppingCart size={18}/>Ajouter aux Courses</h3>
            <input
              autoFocus value={hubQuickName}
              onChange={e=>setHubQuickName(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&addToHubQuick()}
              placeholder="Ex: Lait, tomates..."
              className="w-full p-4 rounded-2xl bg-gray-50 font-bold outline-none border-2 border-transparent focus:border-black"
            />
            <div className="flex gap-3">
              <button onClick={()=>{setShowHubQuick(false);setHubQuickName('');}} className="flex-1 py-3 bg-gray-100 text-gray-600 font-bold rounded-2xl">Annuler</button>
              <button onClick={addToHubQuick} disabled={!hubQuickName.trim()||hubQuickLoading} className="flex-1 py-3 text-white font-black rounded-2xl disabled:opacity-40 flex items-center justify-center gap-2" style={{backgroundColor:config.primaryColor}}>
                {hubQuickLoading?<Loader2 size={15} className="animate-spin"/>:<Plus size={15}/>}Ajouter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ONGLETS FRIGO / CELLIER */}
      <div className="flex gap-2 bg-white p-1.5 rounded-2xl shadow-sm border border-gray-100">
        <button onClick={()=>setFrigotab('frigo')} className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${frigotab==='frigo'?'text-white shadow-md':'text-gray-400'}`} style={frigotab==='frigo'?{backgroundColor:config.primaryColor}:{}}>
          <Refrigerator size={14}/>Frigo ({frigoItems.length})
        </button>
        <button onClick={()=>setFrigotab('cellier')} className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${frigotab==='cellier'?'text-white shadow-md':'text-gray-400'}`} style={frigotab==='cellier'?{backgroundColor:config.primaryColor}:{}}>
          <Package size={14}/>Cellier ({cellierItems.length})
        </button>
      </div>

      {/* ALERTES ANTI-GASPI — seulement onglet frigo */}
      {frigotab==='frigo'&&expiringSoon.length>0&&(
        <div className="bg-red-50 border-2 border-red-200 rounded-3xl p-5">
          <div className="flex items-center gap-3 mb-3"><AlertTriangle className="text-red-500" size={20}/><h3 className="font-black text-red-700 uppercase tracking-widest text-xs">⚠️ Anti-gaspi — bientôt périmés</h3></div>
          <div className="flex flex-wrap gap-2">
            {expiringSoon.map(i=><span key={i.id} className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold">{i.name} — {getExpiryStatus(i)?.label}</span>)}
          </div>
        </div>
      )}

      {/* SAISIE PRINCIPALE */}
      <div className="bg-white p-4 rounded-[2.5rem] shadow-xl border border-gray-100 space-y-3">
        <h3 className="font-black uppercase tracking-widest text-gray-400 text-xs flex items-center gap-2"><Plus size={14}/> AJOUTER UN PRODUIT</h3>

        {/* Ligne 1 : Nom + qté + unité */}
        <div className="flex gap-2">
          <input value={newItem.name} onChange={e=>setNewItem({...newItem,name:e.target.value})} onKeyDown={e=>e.key==='Enter'&&addItem()} placeholder="Nom du produit..." className="flex-1 min-w-0 p-3 bg-gray-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-black transition-colors text-sm"/>
          <input type="number" value={newItem.quantity} onChange={e=>setNewItem({...newItem,quantity:parseInt(e.target.value)||1})} className="w-14 p-3 bg-gray-50 rounded-2xl font-bold text-center outline-none text-sm shrink-0" min={1}/>
          <select value={newItem.unit} onChange={e=>setNewItem({...newItem,unit:e.target.value})} className="p-3 bg-gray-50 rounded-2xl font-bold outline-none text-sm shrink-0">
            <option>pcs</option><option>g</option><option>kg</option><option>ml</option><option>L</option><option>boîte</option>
          </select>
        </div>

        {/* Ligne 2 : Toggle péremption + date (si pas cellier) */}
        {!isCellierInput&&(
          <div className="flex gap-2 items-center">
            <button
              onClick={()=>setNewItem({...newItem,hasExpiry:!newItem.hasExpiry})}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all ${newItem.hasExpiry?'bg-orange-100 text-orange-700':'bg-gray-100 text-gray-400'}`}
            >
              {newItem.hasExpiry?<CalIcon size={12}/>:<X size={12}/>}
              {newItem.hasExpiry?'DLC activée':'Sans DLC'}
            </button>
            {newItem.hasExpiry&&(
              <input type="date" value={newItem.expiryDate} onChange={e=>setNewItem({...newItem,expiryDate:e.target.value})} className="flex-1 min-w-0 p-2.5 bg-gray-50 rounded-xl font-bold text-xs outline-none"/>
            )}
            <button onClick={addItem} disabled={isLoading} className="px-4 py-2.5 bg-black text-white rounded-2xl font-bold hover:scale-105 transition-transform shrink-0 disabled:opacity-50 flex items-center gap-1">
              {isLoading?<Loader2 size={15} className="animate-spin"/>:<Plus size={15}/>}
              <span className="text-xs">Ajouter</span>
            </button>
          </div>
        )}
        {isCellierInput&&(
          <div className="flex gap-2 items-center">
            <button
              onClick={()=>setNewItem({...newItem,hasExpiry:!newItem.hasExpiry})}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all ${newItem.hasExpiry?'bg-orange-100 text-orange-700':'bg-amber-50 text-amber-600 border border-amber-200'}`}
            >
              {newItem.hasExpiry?<CalIcon size={12}/>:<Package size={12}/>}
              {newItem.hasExpiry?'DLC activée':'Activer la péremption'}
            </button>
            {newItem.hasExpiry&&(
              <input type="date" value={newItem.expiryDate} onChange={e=>setNewItem({...newItem,expiryDate:e.target.value})} className="flex-1 min-w-0 p-2.5 bg-gray-50 rounded-xl font-bold text-xs outline-none"/>
            )}
            <button onClick={addItem} disabled={isLoading} className="px-4 py-2.5 bg-black text-white rounded-2xl font-bold hover:scale-105 transition-transform shrink-0 disabled:opacity-50 flex items-center gap-1">
              {isLoading?<Loader2 size={15} className="animate-spin"/>:<Plus size={15}/>}
              <span className="text-xs">Ajouter</span>
            </button>
          </div>
        )}

        {/* Scan codes-barre + IA Photo */}
        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <input value={barcodeInput} onChange={e=>setBarcodeInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&fetchProductByBarcode(barcodeInput)} placeholder="Code-barre..." className="flex-1 min-w-0 p-2.5 bg-gray-50 rounded-xl font-mono text-xs outline-none border-2 border-transparent focus:border-blue-400"/>
          <input ref={barcodePhotoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleBarcodePhoto}/>
          <button onClick={()=>{barcodeInput.trim()?fetchProductByBarcode(barcodeInput):barcodePhotoRef.current?.click();}} disabled={isLoading} className="p-2.5 bg-blue-500 text-white rounded-xl hover:scale-105 transition-transform shrink-0 disabled:opacity-50 flex items-center gap-1">
            {isLoading?<Loader2 size={14} className="animate-spin"/>:barcodeInput.trim()?<Barcode size={14}/>:<Camera size={14}/>}
            <span className="text-[10px] font-bold hidden sm:block">{barcodeInput.trim()?'Valider':'Scanner'}</span>
          </button>
          <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoFile}/>
          <button onClick={()=>photoInputRef.current?.click()} disabled={isLoading} className="p-2.5 bg-purple-500 text-white rounded-xl hover:scale-105 transition-transform shrink-0 disabled:opacity-50 flex items-center gap-1">
            {isLoading?<Loader2 size={14} className="animate-spin"/>:<Brain size={14}/>}
            <span className="text-[10px] font-bold hidden sm:block">IA Photo</span>
          </button>
        </div>
        {scanMsg&&<div className={`text-center text-xs font-bold py-2 px-3 rounded-xl leading-tight ${scanMsg.startsWith('✅')?'bg-green-50 text-green-700':scanMsg.startsWith('⏳')?'bg-blue-50 text-blue-700':'bg-red-50 text-red-700'}`}>{scanMsg}</div>}
      </div>

      {/* INVENTAIRE FRIGO */}
      {frigotab==='frigo'&&(
        <div className="bg-white/80 backdrop-blur-md p-6 rounded-[2.5rem] shadow-xl border border-gray-100">
          <h3 className="font-black uppercase tracking-widest text-gray-400 text-xs flex items-center gap-2 mb-6"><Refrigerator size={14}/> INVENTAIRE FRIGO ({frigoItems.length})</h3>
          {frigoItems.length===0&&<div className="text-center py-12 text-gray-300 italic">Frigo vide !</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {frigoItems.map(item=>{
              const expStatus=getExpiryStatus(item);
              return (
                <div key={item.id} className={`group flex justify-between items-center p-4 rounded-2xl border-l-4 transition-all hover:shadow-md ${expStatus?.icon==='🔴'?'bg-red-50 border-red-400':expStatus?.icon==='🟠'?'bg-orange-50 border-orange-400':'bg-gray-50 border-gray-200'}`}>
                  <div>
                    <span className="font-bold text-gray-800 block">{item.name}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold text-gray-400">{item.quantity} {item.unit}</span>
                      <span className="text-[9px] font-bold text-gray-300 uppercase">{item.category}</span>
                      {expStatus&&<span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${expStatus.color}`}>{expStatus.icon} {expStatus.label}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={()=>{setHubQuickName(item.name);setShowHubQuick(true);}}
                      className="opacity-30 group-hover:opacity-100 p-1.5 bg-orange-50 text-orange-500 rounded-lg hover:bg-orange-100 transition-all"
                      title="Ajouter aux courses"
                    ><ShoppingCart size={13}/></button>
                    <button onClick={()=>deleteItem(item.id)} className="opacity-30 group-hover:opacity-100 md:opacity-0 text-gray-300 hover:text-red-500 transition-opacity touch-action-manipulation"><X size={16}/></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* INVENTAIRE CELLIER — jauges visuelles */}
      {frigotab==='cellier'&&(
        <div className="bg-white/80 backdrop-blur-md p-6 rounded-[2.5rem] shadow-xl border border-gray-100">
          <h3 className="font-black uppercase tracking-widest text-gray-400 text-xs flex items-center gap-2 mb-2"><Package size={14}/> CELLIER ({cellierItems.length})</h3>
          <p className="text-[10px] text-gray-400 italic mb-6">Cliquez sur la jauge pour modifier le niveau (Plein → Moitié → Vide)</p>
          {cellierItems.length===0&&<div className="text-center py-12 text-gray-300 italic">Cellier vide !</div>}

          {/* Grouper par catégorie */}
          {Array.from(new Set(cellierItems.map(i=>i.category))).map(cat=>(
            <div key={cat} className="mb-6">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"/>
                {cat}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {cellierItems.filter(i=>i.category===cat).map(item=>(
                  <div key={item.id} className="group flex justify-between items-center p-3 rounded-2xl bg-amber-50/60 border border-amber-100 hover:shadow-sm transition-all">
                    <div>
                      <span className="font-bold text-gray-800 text-sm">{item.name}</span>
                      <div className="text-[10px] text-gray-400 mt-0.5">{item.quantity} {item.unit}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <GaugeBar level={(item as any).gaugeLevel||'plein'} onClick={()=>cycleGauge(item)}/>
                      <button onClick={()=>deleteItem(item.id)} className="opacity-30 group-hover:opacity-100 md:opacity-0 text-gray-300 hover:text-red-500 transition-opacity"><X size={14}/></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ==========================================
// COMPOSANT MAJORDOME IA (Flottant dans HUB)
// ==========================================
const MajordomeChat = ({ user, config, hubItems, addHubItem, recipes, onAddRecipe, onAddSemainier, isPremium, onShowFreemium }: { user:User, config:SiteConfig, hubItems:any[], addHubItem:(content:string)=>void, recipes?:any[], onAddRecipe?:(r:any)=>void, onAddSemainier?:(title:string)=>void, isPremium?:boolean, onShowFreemium?:()=>void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Array<ChatMessage & {actions?:any[]}>>([
    { role:'assistant', text:'Bonjour ! Je suis votre Majordome. Je peux vous conseiller, suggérer des recettes selon votre frigo, ou ajouter des éléments à vos listes. Que puis-je faire ?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{ if(scrollRef.current) scrollRef.current.scrollTop=scrollRef.current.scrollHeight; },[messages,isOpen]);

  // Quota semaine (3 requêtes/semaine pour free)
  const getWeekKey = () => {
    const d=new Date(); const dn=(d.getDay()+6)%7;
    const mon=new Date(d); mon.setDate(d.getDate()-dn); return mon.toISOString().slice(0,10);
  };

  const send = async () => {
    if(!input.trim()||isLoading) return;

    // Garde freemium
    if(!isPremium) {
      const weekKey = getWeekKey();
      const stored = JSON.parse(localStorage.getItem('butler_quota')||'{}');
      const count = stored[weekKey] || 0;
      if(count >= 3) {
        if(onShowFreemium) onShowFreemium();
        return;
      }
      localStorage.setItem('butler_quota', JSON.stringify({...stored,[weekKey]:count+1}));
    }
    const userMsg = input.trim();
    setInput('');
    const newMsgs = [...messages,{role:'user' as const,text:userMsg}];
    setMessages(newMsgs);
    setIsLoading(true);

    const shopItems = hubItems.filter(i=>i.type==='shop').map(i=>i.content).join(', ');
    const contextData = { shopItems: shopItems||'vide' };

    try {
      const result = await askButlerAgent(
        newMsgs.map(m=>({role:m.role, text:m.text})),
        contextData
      );

      if(result.type === 'action' && result.data?.action === 'ADD_HUB') {
        addHubItem(result.data.item);
        setMessages([...newMsgs,{role:'assistant',text:result.data.reply||`✅ "${result.data.item}" ajouté.`}]);
      } else if(result.type === 'action' && result.data?.action === 'SUGGEST_RECIPE') {
        // Réponse avec boutons d'action pour ajouter la recette
        const recipeTitle = result.data.title || '';
        const actions = [
          ...(onAddRecipe&&recipeTitle ? [{label:'📚 Ajouter aux Recettes', fn:()=>onAddRecipe({title:recipeTitle,category:'plat',chef:'Majordome',ingredients:'',steps:'',image:''})}] : []),
          ...(onAddSemainier&&recipeTitle ? [{label:'🗓️ Planifier au Semainier', fn:()=>onAddSemainier(recipeTitle)}] : []),
        ];
        setMessages([...newMsgs,{role:'assistant',text:result.data.reply||result.data||'', actions}]);
      } else {
        // Détecter si le texte contient une recette suggérée
        const text = typeof result.data === 'string' ? result.data : (result.data?.reply||'Désolé, une erreur est survenue.');
        // Cherche un titre de recette dans le texte (heuristique simple)
        const recipeMatch = text.match(/(?:je vous suggère|proposer|recette\s*:?)\s*[«""]?([^«"".,\n]{3,50})/i);
        const detectedTitle = recipeMatch?.[1]?.trim();
        const actions = detectedTitle ? [
          ...(onAddRecipe ? [{label:'📚 Sauvegarder la recette', fn:()=>onAddRecipe({title:detectedTitle,category:'plat',chef:'Majordome',ingredients:'',steps:'',image:''})}] : []),
          ...(onAddSemainier ? [{label:'🗓️ Planifier au Semainier', fn:()=>onAddSemainier(detectedTitle)}] : []),
        ] : [];
        setMessages([...newMsgs,{role:'assistant',text, actions:actions.length?actions:undefined}]);
      }
    } catch { setMessages([...newMsgs,{role:'assistant',text:'Erreur de connexion au Majordome.'}]); }
    setIsLoading(false);
  };

  // Calcul quota restant affiché
  const weekKey = getWeekKey();
  const storedQuota = typeof window!=='undefined' ? JSON.parse(localStorage.getItem('butler_quota')||'{}') : {};
  const usedThisWeek = storedQuota[weekKey] || 0;
  const remainingQuota = isPremium ? null : Math.max(0, 3 - usedThisWeek);

  return (
    <>
      <button onClick={()=>setIsOpen(true)} className="fixed bottom-28 md:bottom-8 right-6 z-50 w-14 h-14 rounded-full text-white shadow-2xl flex items-center justify-center hover:scale-110 transition-transform relative" style={{backgroundColor:config.primaryColor}}>
        <Bot size={24}/>
        {remainingQuota===0&&<span className="absolute -top-1 -right-1 w-5 h-5 bg-amber-400 rounded-full text-white text-[9px] font-black flex items-center justify-center">!</span>}
        {remainingQuota!==null&&remainingQuota>0&&<span className="absolute -top-1 -right-1 w-5 h-5 bg-gray-900 rounded-full text-white text-[9px] font-black flex items-center justify-center">{remainingQuota}</span>}
      </button>

      {isOpen&&(
        <div className="fixed bottom-28 md:bottom-8 right-6 z-[80] w-80 md:w-96 bg-white rounded-3xl shadow-2xl border border-gray-100 flex flex-col" style={{height:'520px'}}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100 rounded-t-3xl" style={{backgroundColor:config.primaryColor}}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center"><Bot size={16} className="text-white"/></div>
              <div>
                <div className="font-black text-white text-sm">LE MAJORDOME</div>
                <div className="text-white/60 text-[10px]">
                  {isPremium ? 'Conseiller IA — Recettes, Courses, Frigo' : `${remainingQuota} requête${remainingQuota!==1?'s':''} restante${remainingQuota!==1?'s':''} cette semaine`}
                </div>
              </div>
            </div>
            <button onClick={()=>setIsOpen(false)} className="text-white/60 hover:text-white"><X size={20}/></button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m,i)=>(
              <div key={i} className={`flex flex-col ${m.role==='user'?'items-end':''}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${m.role==='user'?'text-white rounded-tr-sm':'bg-gray-50 text-gray-700 rounded-tl-sm'}`} style={m.role==='user'?{backgroundColor:config.primaryColor}:{}}>
                  <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                </div>
                {/* Boutons d'action Recette / Semainier */}
                {m.actions&&m.actions.length>0&&(
                  <div className="flex flex-wrap gap-1.5 mt-1.5 ml-1">
                    {m.actions.map((a,j)=>(
                      <button key={j} onClick={()=>{a.fn(); setMessages(prev=>prev.map((msg,idx)=>idx===i?{...msg,actions:[]}:msg));}} className="text-[10px] font-black px-3 py-1.5 rounded-xl border-2 border-opacity-30 hover:scale-105 transition-transform" style={{borderColor:config.primaryColor,color:config.primaryColor,backgroundColor:`${config.primaryColor}15`}}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
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
const HubView = ({ user, config, usersMapping, recipes, onAddRecipe, onAddSemainier, isPremium, onShowFreemium }: { user:User, config:SiteConfig, usersMapping:any, recipes?:any[], onAddRecipe?:(r:any)=>void, onAddSemainier?:(title:string)=>void, isPremium?:boolean, onShowFreemium?:()=>void }) => {
  const [hubItems, setHubItems] = useState<any[]>([]);
  const [newItem, setNewItem] = useState('');
  const [storeSearch, setStoreSearch] = useState('');
  const [selectedStore, setSelectedStore] = useState('');
  const [inputType, setInputType] = useState<'shop'|'note'|'msg'>('shop');
  const [showStoreList, setShowStoreList] = useState(false);
  // Quick-add to Frigo modal
  const [showFrigoQuick, setShowFrigoQuick] = useState(false);
  const [frigoQuickName, setFrigoQuickName] = useState('');
  const [frigoQuickLoading, setFrigoQuickLoading] = useState(false);

  useEffect(() => {
    const q=query(collection(db,'hub_items'),orderBy('createdAt','desc'));
    const unsub=onSnapshot(q,s=>setHubItems(s.docs.map(d=>({id:d.id,...d.data()}))));
    return ()=>unsub();
  },[]);

  const addToFrigoQuick = async () => {
    if(!frigoQuickName.trim()) return;
    setFrigoQuickLoading(true);
    try {
      const { classifyFrigoItem } = await import('./services/geminiService');
      const aiResult = await classifyFrigoItem(frigoQuickName.trim());
      const category = aiResult?.category || categorizeShoppingItem(frigoQuickName);
      const isCellier = CELLIER_CATEGORIES.includes(category);
      await addDoc(collection(db,'frigo_items'),{
        name: frigoQuickName.trim(), category,
        expiryDate: isCellier ? '' : (aiResult?.expiryDate||''),
        gaugeLevel: isCellier ? 'plein' : undefined,
        quantity:1, unit:'pcs', addedAt:new Date().toISOString()
      });
      setFrigoQuickName(''); setShowFrigoQuick(false);
    } catch {
      await addDoc(collection(db,'frigo_items'),{
        name:frigoQuickName.trim(), category:categorizeShoppingItem(frigoQuickName),
        quantity:1, unit:'pcs', addedAt:new Date().toISOString()
      });
      setFrigoQuickName(''); setShowFrigoQuick(false);
    }
    setFrigoQuickLoading(false);
  };

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

      {/* MODALE AJOUT RAPIDE FRIGO */}
      {showFrigoQuick&&(
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={()=>setShowFrigoQuick(false)}>
          <div className="bg-white rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm shadow-2xl space-y-4" onClick={e=>e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{backgroundColor:`${config.primaryColor}20`}}>
                <Refrigerator size={20} style={{color:config.primaryColor}}/>
              </div>
              <div>
                <h3 className="font-black text-lg">Ajouter au Frigo</h3>
                <p className="text-xs text-gray-400">L'IA classifie automatiquement</p>
              </div>
            </div>
            <input
              value={frigoQuickName}
              onChange={e=>setFrigoQuickName(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&addToFrigoQuick()}
              placeholder="Nom du produit..."
              className="w-full p-4 rounded-2xl bg-gray-50 font-bold outline-none border-2 border-transparent focus:border-black transition-colors"
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={()=>setShowFrigoQuick(false)} className="flex-1 py-3 bg-gray-100 text-gray-600 font-bold rounded-2xl">Annuler</button>
              <button onClick={addToFrigoQuick} disabled={!frigoQuickName.trim()||frigoQuickLoading} className="flex-1 py-3 text-white font-black rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50" style={{backgroundColor:config.primaryColor}}>
                {frigoQuickLoading?<Loader2 size={16} className="animate-spin"/>:<Plus size={16}/>}
                Ajouter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SAISIE RAPIDE */}
      <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-gray-100 md:sticky md:top-24 z-30" id="hub-input">
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
          <h3 className="font-bold text-xl tracking-tight text-gray-400 flex items-center gap-2"><ShoppingCart size={20}/> LISTE DE COURSES</h3>
          {sortedShopItems.map(item=>(
            <div key={item.id} className="group flex justify-between items-center p-4 bg-white rounded-2xl shadow-sm border-l-4 border-orange-400 hover:shadow-md transition-all">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] font-black uppercase text-orange-600 bg-orange-100 px-2 py-0.5 rounded-md">{item.category}</span>
                  {item.store&&<span className="text-[9px] font-bold uppercase text-gray-400 bg-gray-100 px-2 py-0.5 rounded-md"><Store size={8} className="inline mr-1"/>{item.store}</span>}
                </div>
                <span className="font-bold text-gray-700 block">{item.content}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={()=>{setFrigoQuickName(item.content);setShowFrigoQuick(true);}}
                  className="opacity-30 group-hover:opacity-100 md:opacity-0 p-1.5 bg-teal-50 text-teal-600 rounded-lg hover:bg-teal-100 transition-all"
                  title="Ajouter au Frigo"
                ><Refrigerator size={13}/></button>
                <button onClick={()=>deleteItem(item.id)} className="text-gray-300 hover:text-red-500"><X size={18}/></button>
              </div>
            </div>
          ))}
          {sortedShopItems.length===0&&<div className="text-center p-8 border-2 border-dashed border-gray-200 rounded-2xl text-gray-300">Frigo plein !</div>}
        </div>

        {/* PENSE-BÊTES */}
        <div className="space-y-4" id="hub-notes">
          <h3 className="font-bold text-xl tracking-tight text-gray-400 flex items-center gap-2"><StickyNote size={20}/> PENSE-BÊTES</h3>
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
          <h3 className="font-bold text-xl tracking-tight text-gray-400 flex items-center gap-2"><MessageSquare size={20}/> LE MUR</h3>
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
      <MajordomeChat
        user={user} config={config} hubItems={hubItems}
        addHubItem={(content)=>addItem(content)}
        recipes={recipes}
        onAddRecipe={onAddRecipe}
        onAddSemainier={onAddSemainier}
        isPremium={isPremium}
        onShowFreemium={onShowFreemium}
      />
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
      <div className="flex flex-wrap justify-center gap-3 mb-8">
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
                <div className="flex justify-between items-center mb-2"><span className="font-bold text-xl tracking-tight">{d.from}<span className="text-gray-300 text-xs mx-1">DOIT À</span>{d.to}</span><span className="text-2xl font-black" style={{color:config.primaryColor}}>{calculateDebt(d)}€</span></div>
                <div className="flex gap-4 text-[10px] font-bold uppercase text-gray-400"><span>Initial:{d.amount}€</span>{d.interest>0&&<span className="text-orange-400 flex items-center"><Percent size={10} className="mr-1"/>Intérêt:{d.interest}%</span>}<span>{new Date(d.createdAt).toLocaleDateString()}</span></div>
              </div>
            ))}
          </div>
        </div>
      ):(
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <div className="relative h-64 w-full"><CircleLiquid fillPercentage={fillPercent}/><div className="absolute inset-0 flex flex-col items-center justify-center"><p className="text-[10px] font-black uppercase text-yellow-800/60 tracking-widest mb-1">Solde Actuel</p><h2 className="text-3xl md:text-5xl font-black tracking-tight text-yellow-900 drop-shadow-sm mb-4">{myWallet.balance?.toFixed(0)}€</h2><div className="flex items-center gap-2 bg-white/40 p-1.5 rounded-2xl backdrop-blur-sm shadow-sm border border-white/50 w-48"><button onClick={()=>updateBalance('sub')} className="p-2 bg-white/50 hover:bg-red-400 hover:text-white rounded-xl transition-colors"><Minus size={16}/></button><input type="number" value={walletAmount} onChange={e=>setWalletAmount(e.target.value)} className="w-full bg-transparent text-center font-bold text-lg outline-none text-yellow-900 placeholder-yellow-800/40" placeholder="..."/><button onClick={()=>updateBalance('add')} className="p-2 bg-white/50 hover:bg-green-400 hover:text-white rounded-xl transition-colors"><Plus size={16}/></button></div></div></div>
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
        <div className="text-center space-y-2"><div className="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4"><CalIcon size={32} style={{color:config.primaryColor}}/></div><h3 className="text-2xl font-bold tracking-tight">Nouvel Événement</h3></div>
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
    <div className="fixed inset-0 z-[500] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div
        className="bg-white w-full md:max-w-2xl rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl relative animate-in slide-in-from-bottom md:zoom-in-95 duration-300 overflow-y-auto"
        style={{maxHeight:'calc(100vh - 1rem)', paddingBottom:'calc(1.5rem + env(safe-area-inset-bottom, 0px))'}}
      >
        <div className="sticky top-0 bg-white z-10 px-8 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between">
          <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto md:hidden absolute top-3 left-1/2 -translate-x-1/2"/>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center hidden md:flex"><ChefHat size={22} style={{color:config.primaryColor}}/></div>
            <h3 className="text-xl font-bold tracking-tight">{currentRecipe.id?'Modifier la Recette':'Nouvelle Recette'}</h3>
          </div>
          <button onClick={()=>onClose(false)} className="text-gray-400 hover:text-black p-2 rounded-full hover:bg-gray-100"><X size={22}/></button>
        </div>

        <div className="px-6 md:px-8 pt-5 space-y-4">
          {/* IMPORT URL */}
          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
            <h4 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2"><Link size={12}/> Import depuis URL</h4>
            <div className="flex gap-2">
              <input value={recipeUrl} onChange={e=>setRecipeUrl(e.target.value)} placeholder="https://www.marmiton.org/recettes/..." className="flex-1 min-w-0 p-3 rounded-xl border border-gray-200 bg-white text-sm font-bold outline-none"/>
              <button onClick={importFromUrl} disabled={isImporting||!recipeUrl} className="px-4 py-3 bg-purple-500 text-white rounded-xl hover:scale-105 transition-transform flex items-center gap-2 disabled:opacity-50 shrink-0">
                {isImporting?<Loader2 size={16} className="animate-spin"/>:<Brain size={16}/>}
                <span className="text-xs font-bold hidden sm:block">{isImporting?'Import...':'Importer'}</span>
              </button>
            </div>
          </div>

          <input value={currentRecipe.title} onChange={e=>setCurrentRecipe({...currentRecipe,title:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 text-lg font-bold outline-none" placeholder="Nom du plat..." autoFocus/>
          <div className="flex gap-3">
            <input value={currentRecipe.chef} onChange={e=>setCurrentRecipe({...currentRecipe,chef:e.target.value})} className="flex-1 p-3 rounded-xl border border-gray-200 bg-gray-50 outline-none text-sm" placeholder="Chef (ex: Papa)"/>
            <select value={currentRecipe.category} onChange={e=>setCurrentRecipe({...currentRecipe,category:e.target.value})} className="flex-1 p-3 rounded-xl border border-gray-200 bg-gray-50 outline-none text-sm">
              <option value="entrée">Entrée</option><option value="plat">Plat</option><option value="dessert">Dessert</option><option value="autre">Autre</option>
            </select>
          </div>
          <div onClick={()=>!isCompressing&&fileRef.current?.click()} className="p-5 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 flex items-center justify-center gap-3 text-gray-400">
            {isCompressing?<><Loader2 className="animate-spin" size={18}/><span className="text-sm font-bold text-blue-500">Compression...</span></>
            :currentRecipe.image?<><CheckCircle2 size={18} className="text-green-500"/><span className="text-sm font-bold text-green-600">Photo ajoutée !</span></>
            :<><Upload size={18}/><span className="text-sm">Ajouter une photo</span></>}
          </div>
          <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e=>handleFile(e,(b:string)=>setCurrentRecipe({...currentRecipe,image:b}))}/>
          <div className="grid md:grid-cols-2 gap-4">
            <textarea value={currentRecipe.ingredients} onChange={e=>setCurrentRecipe({...currentRecipe,ingredients:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none h-36 text-sm resize-none" placeholder="Ingrédients (un par ligne)..."/>
            <textarea value={currentRecipe.steps} onChange={e=>setCurrentRecipe({...currentRecipe,steps:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none h-36 text-sm resize-none" placeholder="Étapes de préparation..."/>
          </div>
          <button
            disabled={isSubmitting||isCompressing}
            onClick={async()=>{if(currentRecipe.title){setIsSubmitting(true);const r={...currentRecipe};try{if(r.id){await updateEntry('family_recipes',r.id,r);}else{await addEntry('family_recipes',r);}setIsSubmitting(false);onClose(false);}catch(e){alert("Image trop lourde ou erreur.");setIsSubmitting(false);}}else{alert("Il faut au moins un titre !");}}}
            className={`w-full py-4 rounded-xl font-black text-white uppercase tracking-widest shadow-lg transition-all mb-2 ${isSubmitting||isCompressing?'opacity-50 cursor-not-allowed':''}`}
            style={{backgroundColor:config.primaryColor}}
          >
            {isSubmitting?"Enregistrement...":(isCompressing?"Traitement image...":"Enregistrer la recette")}
          </button>
        </div>
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
        {id:'wishlist', label:'Les WishLists 🎁'},
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

const BottomNav = ({ config, view, setView, hidden }: any) => (
  <div className={`md:hidden fixed bottom-0 w-full h-24 flex justify-around items-center rounded-t-[2.5rem] z-40 text-white/50 px-4 pb-4 shadow-xl transition-transform duration-300 ${hidden ? 'translate-y-full' : 'translate-y-0'}`} style={{backgroundColor:config.primaryColor}}>
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
  <div onClick={onClick} className="bg-white/70 backdrop-blur-md p-6 md:p-10 rounded-[2rem] md:rounded-[3rem] cursor-pointer hover:scale-105 transition-transform shadow-lg border border-white/50 group">
    <div style={{color}} className="mb-6 group-hover:scale-110 transition-transform">{icon}</div>
    <h3 className="text-xl md:text-3xl font-bold tracking-tight mb-2">{title}</h3>
    <p className="text-[10px] font-bold tracking-widest opacity-50 uppercase flex items-center gap-2">{label}<ChevronRight size={14}/></p>
  </div>
);

// ==========================================
// AUTO-SAVE SETTINGS (paramètres silencieux)
// ==========================================
const AutoSaveSettings = ({ localC, save, config, setLocalC, fileRef, handleFile, lockedPagesMap, onSaveMaintenance }: any) => {
  const [saveStatus, setSaveStatus] = useState<'idle'|'saving'|'saved'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const isFirstRender = useRef(true);

  // Auto-save localC (textes, images, html) avec debounce 800ms
  useEffect(() => {
    if(isFirstRender.current) { isFirstRender.current = false; return; }
    setSaveStatus('saving');
    if(timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      await save(localC, false);
      setSaveStatus('saved');
      setTimeout(()=>setSaveStatus('idle'), 2500);
    }, 800);
    return () => { if(timerRef.current) clearTimeout(timerRef.current); };
  }, [localC]);

  // Save lockedPages immediately (doc séparé, invisible dans historique)
  const saveLock = async (pages: Record<string,boolean>) => {
    if(onSaveMaintenance) await onSaveMaintenance(pages);
  };

  return (
    <div className="space-y-8 animate-in fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-3xl font-bold tracking-tight" style={{color:config.primaryColor}}>PARAMÈTRES</h3>
        <div className={`flex items-center gap-1.5 text-xs font-bold transition-all duration-300 ${
          saveStatus==='saving' ? 'text-amber-500' :
          saveStatus==='saved'  ? 'text-green-500' :
          'text-gray-300'
        }`}>
          {saveStatus==='saving' && <><Loader2 size={12} className="animate-spin"/>Sauvegarde…</>}
          {saveStatus==='saved'  && <><CheckCircle2 size={12}/>Sauvegardé</>}
          {saveStatus==='idle'   && <><Cloud size={12}/>Auto-sauvegarde</>}
        </div>
      </div>

      {/* MAINTENANCE — stockée dans site_config/maintenance (séparé) */}
      <div className="bg-black p-6 rounded-3xl space-y-5">
        <h4 className="font-black text-white uppercase tracking-widest text-sm flex items-center gap-2"><Lock size={16}/> MODE MAINTENANCE — PAR PAGE</h4>
        <p className="text-gray-400 text-sm leading-relaxed">
          Sélectionnez les pages à verrouiller. Les pages verrouillées affichent
          <span className="text-white font-bold mx-1">"Ici, débute le futur"</span>
          pour tous les membres sauf l'admin.
          <span className="block mt-1 text-gray-500 text-xs">L'administrateur garde toujours accès complet.</span>
        </p>

        <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/10">
          <div>
            <span className="text-white font-bold text-sm">Tout verrouiller</span>
            <p className="text-gray-500 text-xs mt-0.5">Verrouille toutes les pages pour les membres</p>
          </div>
          <button
            onClick={()=>{
              const allLocked = Object.keys(ORIGINAL_CONFIG.navigationLabels).reduce((acc, key) => ({...acc, [key]: true}), {} as Record<string,boolean>);
              saveLock(allLocked);
            }}
            className="px-4 py-2 bg-red-600 text-white rounded-xl font-bold text-xs hover:bg-red-500 transition-colors"
          >🔒 Tout fermer</button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(ORIGINAL_CONFIG.navigationLabels).map(([key, label]) => {
            const isLocked = !!(lockedPagesMap as any)[key];
            return (
              <button
                key={key}
                onClick={()=>{
                  const updated = {...(lockedPagesMap as any), [key]: !isLocked};
                  saveLock(updated);
                }}
                className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                  isLocked ? 'bg-red-900/40 border-red-500/50 text-red-300' : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                }`}
              >
                <span className="font-bold text-xs uppercase tracking-wide">{label as string}</span>
                <span className="text-sm">{isLocked ? '🔒' : '🔓'}</span>
              </button>
            );
          })}
        </div>

        <button
          onClick={()=>saveLock({})}
          className="w-full py-3 border border-white/20 text-gray-400 font-bold rounded-xl hover:bg-white/5 transition-colors text-xs uppercase tracking-widest"
        >🔓 Tout déverrouiller</button>
      </div>

      {/* PAGE ACCUEIL */}
      <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 space-y-4">
        <h4 className="font-black text-gray-600 uppercase tracking-widest text-sm flex items-center gap-2"><Home size={16}/> PAGE D'ACCUEIL</h4>
        <input value={localC.welcomeTitle||''} onChange={e=>setLocalC((c:any)=>({...c,welcomeTitle:e.target.value}))} className="w-full p-5 rounded-2xl border border-gray-200" placeholder="Titre principal"/>
        <textarea value={localC.welcomeText||''} onChange={e=>setLocalC((c:any)=>({...c,welcomeText:e.target.value}))} className="w-full p-5 rounded-2xl border border-gray-200 h-24" placeholder="Texte de bienvenue"/>
        <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e=>handleFile(e,(b:string)=>setLocalC((c:any)=>({...c,welcomeImage:b})))}/>
        <div onClick={()=>fileRef.current?.click()} className="p-4 border-2 border-dashed rounded-2xl text-center cursor-pointer text-xs uppercase font-bold text-gray-400 hover:border-gray-400 transition-colors">Changer la photo d'accueil</div>
        <div>
          <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Widget / Code HTML</label>
          <textarea value={localC.homeHtml||''} onChange={e=>setLocalC((c:any)=>({...c,homeHtml:e.target.value}))} className="w-full p-5 rounded-2xl border border-gray-200 h-32 font-mono text-xs" placeholder="Code HTML/Widget pour l'accueil (Optionnel)"/>
          <p className="text-[10px] text-gray-400 mt-1 ml-1">Ce code s'affiche directement sur la page d'accueil.</p>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// ADMIN PANEL (RÉORGANISÉ)
// ==========================================
const AdminPanel = ({ config, save, add, del, upd, events, recipes, xsitePages, versions, restore, arch, chat, prompt, setP, load, hist, users, choreStatus, lockedPagesMap, onSaveMaintenance }: any) => {
  const [tab, setTab] = useState('users');
  const [newUser, setNewUser] = useState({email:'',letter:'',name:''});
  const [localC, setLocalC] = useState(config);
  const [editingVersionId, setEditingVersionId] = useState<string|null>(null);
  const [tempVersionName, setTempVersionName] = useState('');
  const [editingVersionImg, setEditingVersionImg] = useState<string|null>(null); // id version dont on édite l'image
  const versionImgRef = useRef<HTMLInputElement>(null);
  const [currentXSite, setCurrentXSite] = useState({id:'',name:'',html:''});
  const [qrCodeUrl, setQrCodeUrl] = useState<string|null>(null);
  const [notif, setNotif] = useState<Partial<AppNotification>>({message:'',type:'info',repeat:'once',linkView:'',linkId:'',targets:['all']});
  const [aiRules, setAiRules] = useState<any[]>([]);
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

  const [toast, setToast] = useState<{msg:string,ok:boolean}|null>(null);
  const showToast = (msg:string, ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast(null),4000); };

  const handleFile=(e:any,cb:any)=>{const f=e.target.files[0];if(f){const r=new FileReader();r.onload=()=>cb(r.result);r.readAsDataURL(f);}};
  const startEditVersion=(v:any)=>{setEditingVersionId(v.id);setTempVersionName(v.name);};
  const saveVersionName=(id:string)=>{upd('site_versions',id,{name:tempVersionName});setEditingVersionId(null);};
  const generateQrCode=(siteId:string)=>{const baseUrl=window.location.href.split('?')[0];const fullUrl=`${baseUrl}?id=${siteId}`;const apiUrl=`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(fullUrl)}`;setQrCodeUrl(apiUrl);};
  const copyCookingLink=()=>{const baseUrl=window.location.href.split('?')[0];const fullUrl=`${baseUrl}?view=cooking`;navigator.clipboard.writeText(fullUrl);alert("Lien copié !");};;

  const registerUser=async()=>{
    if(!newUser.email||!newUser.letter)return alert("Email et Lettre requis");
    await setDoc(doc(db,'site_users',newUser.email),{...newUser,plan:'free',createdAt:new Date().toISOString()});
    setNewUser({email:'',letter:'',name:''});
    showToast("Utilisateur ajouté !");
  };

  const [editingUser, setEditingUser] = useState<any|null>(null);
  const saveEditUser = async () => {
    if(!editingUser) return;
    await updateDoc(doc(db,'site_users',editingUser.id),{
      name:editingUser.name, letter:editingUser.letter, plan:editingUser.plan||'free'
    });
    showToast("Utilisateur mis à jour !");
    setEditingUser(null);
  };

  const saveUserField = async (userId: string, field: string, value: string) => {
    await updateDoc(doc(db,'site_users',userId),{[field]:value});
    showToast("Sauvegardé ✓");
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
    <div className="bg-white/90 backdrop-blur-xl p-4 md:p-8 rounded-[2rem] md:rounded-[3.5rem] shadow-2xl min-h-[700px] border border-black/5">
      <div className="flex gap-2 overflow-x-auto mb-10 pb-4 no-scrollbar">
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest whitespace-nowrap transition-all ${tab===t.id?'text-white scale-105 shadow-lg':'bg-gray-100 text-gray-400'}`} style={{backgroundColor:tab===t.id?config.primaryColor:''}}>{t.i}{t.l}</button>
        ))}
      </div>

      {/* USERS */}
      {tab==='users'&&(
        <div className="space-y-8 animate-in fade-in">
          <h3 className="text-3xl font-bold tracking-tight" style={{color:config.primaryColor}}>UTILISATEURS</h3>

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
              <div key={u.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Ligne principale */}
                <div className="flex items-center gap-3 p-4">
                  {/* Avatar lettre — clic pour modifier */}
                  <div className="relative group/letter">
                    <div className="w-11 h-11 rounded-full flex items-center justify-center font-black text-white text-lg shrink-0 cursor-pointer hover:opacity-80 transition-opacity" style={{backgroundColor:config.primaryColor}}>
                      {u.letter||'?'}
                    </div>
                    <input
                      defaultValue={u.letter||''}
                      maxLength={1}
                      onBlur={e=>{const v=e.target.value.toUpperCase().trim();if(v&&v!==u.letter)saveUserField(u.id,'letter',v);}}
                      onChange={e=>e.target.value=e.target.value.toUpperCase().slice(0,1)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer rounded-full text-center"
                      title="Cliquer pour modifier la lettre"
                    />
                  </div>

                  {/* Nom — cliquable directement */}
                  <div className="flex-1 min-w-0">
                    <input
                      key={u.id+'-name'}
                      defaultValue={u.name||''}
                      placeholder="Prénom"
                      onBlur={e=>{const v=e.target.value.trim();if(v!==u.name)saveUserField(u.id,'name',v);}}
                      className="font-bold text-gray-800 bg-transparent outline-none border-b-2 border-transparent focus:border-gray-300 w-full transition-colors placeholder-gray-300"
                    />
                    <div className="text-[10px] text-gray-400 truncate">{u.id}</div>
                    <div className="text-[10px] text-gray-300">{u.lastLogin?`Vu ${new Date(u.lastLogin).toLocaleDateString()}`:'Jamais connecté'}</div>
                  </div>

                  {/* Plan — toggle direct */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={()=>saveUserField(u.id,'plan','free')}
                      className={`px-3 py-1.5 rounded-xl font-black text-[10px] uppercase transition-all ${!u.plan||u.plan==='free'?'bg-gray-900 text-white':'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                    >Gratuit</button>
                    <button
                      onClick={()=>saveUserField(u.id,'plan','pro')}
                      className={`px-3 py-1.5 rounded-xl font-black text-[10px] uppercase transition-all ${u.plan==='pro'?'text-white shadow-md':'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                      style={u.plan==='pro'?{backgroundColor:config.primaryColor}:{}}
                    >☕ Premium</button>
                    <button onClick={()=>del('site_users',u.id)} className="p-1.5 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors ml-1"><Trash2 size={14}/></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* NOTIF */}
      {tab==='notif'&&(
        <div className="space-y-8 animate-in fade-in">
          <h3 className="text-3xl font-bold tracking-tight" style={{color:config.primaryColor}}>NOTIFICATIONS</h3>

          {/* MODE MANUEL UNIQUEMENT */}
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
          <h3 className="text-3xl font-bold tracking-tight" style={{color:config.primaryColor}}>HISTORIQUE</h3>
          {/* Input caché pour changer la photo d'une version */}
          <input
            ref={versionImgRef}
            type="file" accept="image/*" className="hidden"
            onChange={async e=>{
              const f=e.target.files?.[0];
              e.target.value='';
              if(!f||!editingVersionImg) return;
              const r=new FileReader();
              r.onload=async()=>{
                try {
                  // updateDoc avec notation point Firestore pour champ imbriqué
                  await updateDoc(doc(db,'site_versions',editingVersionImg),{'config.welcomeImage': r.result as string});
                } catch(e){ console.error('update version img error',e); }
                setEditingVersionImg(null);
              };
              r.readAsDataURL(f);
            }}
          />
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {versions.length===0&&<div className="text-center text-gray-400 italic py-8">Aucune version sauvegardée</div>}
            {versions.map((v:SiteVersion)=>(
              <div key={v.id} className="flex gap-4 items-center p-4 bg-gray-50 rounded-2xl border border-gray-100 group hover:border-gray-300 transition-all">
                {/* Miniature cliquable */}
                <div className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0 border border-gray-200 shadow-sm cursor-pointer group/img"
                  onClick={()=>{setEditingVersionImg(v.id);versionImgRef.current?.click();}}
                  title="Cliquer pour changer la photo"
                >
                  {v.config?.welcomeImage
                    ? <img src={v.config.welcomeImage} alt="aperçu" className="w-full h-full object-cover"/>
                    : <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-400"><ImageIcon size={20}/></div>
                  }
                  {/* Overlay au survol */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                    <ImageIcon size={14} className="text-white"/>
                    <span className="text-[9px] text-white font-bold">Changer</span>
                  </div>
                </div>
                {/* Infos version */}
                <div className="flex-1 min-w-0">
                  {editingVersionId===v.id?(
                    <div className="flex gap-2">
                      <input value={tempVersionName} onChange={e=>setTempVersionName(e.target.value)} className="flex-1 p-2 rounded-lg border border-gray-300 text-sm" autoFocus/>
                      <button onClick={()=>saveVersionName(v.id)} className="p-2 bg-green-100 text-green-600 rounded-lg"><Save size={14}/></button>
                      <button onClick={()=>setEditingVersionId(null)} className="p-2 bg-red-100 text-red-600 rounded-lg"><X size={14}/></button>
                    </div>
                  ):(
                    <div>
                      <div className="font-bold text-sm flex items-center gap-2 truncate">
                        {v.name}
                        <button onClick={()=>startEditVersion(v)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-opacity shrink-0"><Pencil size={11}/></button>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">{new Date(v.date).toLocaleString('fr-FR')}</div>
                      {v.config&&(
                        <div className="flex items-center gap-2 mt-1">
                          <div className="w-3 h-3 rounded-full border border-white shadow-sm" style={{backgroundColor:v.config.primaryColor||'#888'}}/>
                          <span className="text-[10px] text-gray-400 truncate max-w-[160px]">{v.config.welcomeTitle||''}</span>
                          {v.config.welcomeImage&&(
                            <button
                              onClick={async()=>{
                                try{ await updateDoc(doc(db,'site_versions',v.id),{'config.welcomeImage':''}); }
                                catch(e){ console.error(e); }
                              }}
                              className="text-[9px] text-red-400 hover:text-red-600 font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                              title="Supprimer la photo de cette version"
                            >✕ photo</button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* Actions */}
                <div className="flex gap-2 shrink-0">
                  <button onClick={()=>del('site_versions',v.id)} className="p-2.5 bg-white border border-red-100 text-red-400 rounded-xl hover:bg-red-500 hover:text-white transition-colors"><Trash2 size={15}/></button>
                  <button onClick={()=>restore(v)} className="p-2.5 bg-white border border-gray-200 rounded-xl hover:bg-black hover:text-white transition-colors" title="Restaurer cette version"><RotateCcw size={15}/></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ARCHITECTE */}
      {tab==='arch'&&(
        <div className="space-y-6 animate-in fade-in">
          <h3 className="text-3xl font-bold tracking-tight" style={{color:config.primaryColor}}>ARCHITECTE IA</h3>
          <textarea value={prompt} onChange={e=>setP(e.target.value)} className="w-full p-6 rounded-3xl border border-gray-200 h-32 focus:ring-4 outline-none" placeholder="Ex: 'Met un thème sombre et doré'..."/>
          <button onClick={arch} disabled={load} className="w-full py-5 text-white rounded-2xl font-black uppercase shadow-xl" style={{backgroundColor:config.primaryColor}}>{load?<Loader2 className="animate-spin mx-auto"/>:"Transformer le design"}</button>
        </div>
      )}

      {/* XSITE */}
      {tab==='xsite'&&(
        <div className="space-y-8 animate-in fade-in">
          <h3 className="text-3xl font-bold tracking-tight" style={{color:config.primaryColor}}>GESTION XSITE</h3>
          {qrCodeUrl&&(
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4" onClick={()=>setQrCodeUrl(null)}>
              <div className="bg-white p-8 rounded-3xl text-center space-y-4 animate-in zoom-in-95" onClick={e=>e.stopPropagation()}>
                <h4 className="font-bold text-xl tracking-tight">Scannez ce code</h4>
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
        <AutoSaveSettings localC={localC} save={save} config={config} setLocalC={setLocalC} fileRef={fileRef} handleFile={handleFile} lockedPagesMap={lockedPagesMap||{}} onSaveMaintenance={onSaveMaintenance}/>
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

const SemainierView = ({config, recipes, isPremium, onShowFreemium}:{config:SiteConfig, recipes:Recipe[], isPremium?:boolean, onShowFreemium?:()=>void}) => {
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
    setFavSelectVal('');
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

  const [favSelectVal, setFavSelectVal] = useState('');

  const loadFav = (fav:any) => {
    setForm(f=>({...f,platName:fav.platName,recetteLink:fav.recetteLink||'',notes:fav.notes||''}));
  };

  // Sur mobile : sélection d'un favori → pré-remplit le formulaire
  const onFavSelect = (idx:string) => {
    if(idx==='') return;
    setFavSelectVal(idx);
    const fav = favs[parseInt(idx)];
    if(fav) loadFav(fav);
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
        <h2 className="text-3xl font-black tracking-tight" style={{color:config.primaryColor}}>SEMAINIER</h2>
        <div className="flex items-center gap-3">
          <button onClick={()=>setWeekOffset(w=>w-1)} className="w-10 h-10 rounded-full border-2 flex items-center justify-center font-black text-lg hover:bg-black hover:text-white transition-colors" style={{borderColor:config.primaryColor,color:config.primaryColor}}>‹</button>
          <span className="font-bold text-sm text-gray-600 min-w-[200px] text-center">{weekLabel}</span>
          <button
            onClick={()=>{
              if(!isPremium&&weekOffset>=1){if(onShowFreemium)onShowFreemium();return;}
              setWeekOffset(w=>w+1);
            }}
            className="w-10 h-10 rounded-full border-2 flex items-center justify-center font-black text-lg hover:bg-black hover:text-white transition-colors relative"
            style={{borderColor:config.primaryColor,color:config.primaryColor}}
          >
            ›{!isPremium&&weekOffset>=1&&<span className="absolute -top-1 -right-1 text-[8px] bg-amber-400 text-white rounded-full w-4 h-4 flex items-center justify-center">☕</span>}
          </button>
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
                          <button onClick={e=>deleteMeal(day,meal,e)} className="absolute top-1 left-1 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center opacity-30 md:opacity-0 group-hover:opacity-100 transition-opacity z-10">×</button>
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
        <div className="fixed inset-0 z-[500] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={()=>setModal(null)}>
          <div
            className="bg-white rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-md shadow-2xl space-y-4 overflow-y-auto"
            style={{maxHeight:'calc(100vh - 1rem)', paddingBottom:'calc(1.5rem + env(safe-area-inset-bottom, 0px))'}}
            onClick={e=>e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-black tracking-tight" style={{color:config.primaryColor}}>{modal.meal} — {modal.day}</h3>
              <button onClick={()=>setModal(null)} className="text-gray-400 hover:text-black p-1"><X size={20}/></button>
            </div>

            {/* Sélecteur recettes/favoris */}
            {favs.length>0&&(
              <div className="space-y-1">
                <select
                  value={favSelectVal}
                  onChange={e=>onFavSelect(e.target.value)}
                  className="w-full p-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-sm font-bold outline-none focus:border-black"
                >
                  <option value="">⭐ Choisir une recette...</option>
                  {favs.map((f,i)=><option key={i} value={i}>{f.platName}</option>)}
                </select>
                {favSelectVal!==''&&<p className="text-[10px] text-gray-400 italic pl-1">Recette chargée — sélectionnez les participants puis Enregistrer</p>}
              </div>
            )}

            <input value={form.platName} onChange={e=>setForm(f=>({...f,platName:e.target.value}))} placeholder="Nom du plat *" className="w-full p-3 rounded-xl border-2 border-gray-200 font-bold outline-none focus:border-black text-sm"/>
            <input value={form.recetteLink} onChange={e=>setForm(f=>({...f,recetteLink:e.target.value}))} placeholder="Lien recette (optionnel)" className="w-full p-3 rounded-xl border border-gray-200 text-sm outline-none"/>
            <textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Notes (optionnel)" className="w-full p-3 rounded-xl border border-gray-200 text-sm outline-none h-16 resize-none"/>

            <div>
              <p className="font-black text-xs uppercase text-gray-400 mb-2">Participants *</p>
              <div className="grid grid-cols-3 gap-2">
                {PARTICIPANTS.map(p=>(
                  <button key={p} type="button" onClick={()=>toggleParticipant(p)} className={`p-2.5 rounded-xl font-bold text-xs transition-all border-2 ${form.participants.includes(p)?'text-white border-transparent':'bg-gray-50 text-gray-600 border-gray-200'}`} style={form.participants.includes(p)?{backgroundColor:config.primaryColor,borderColor:config.primaryColor}:{}}>{p}</button>
                ))}
              </div>
            </div>

            <button onClick={saveModal} className="w-full py-4 text-white font-black rounded-2xl uppercase tracking-widest shadow-lg" style={{backgroundColor:config.primaryColor}}>Enregistrer</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================
// PAGE MAINTENANCE (par page)
// ==========================================
const MaintenancePage = ({ pageName, isHome }: { pageName?: string, isHome?: boolean }) => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] py-20 bg-black rounded-[3rem]">
    <div className="text-center space-y-8 animate-in fade-in duration-1000 px-8">
      <div className="w-20 h-20 mx-auto border border-white/10 rounded-full flex items-center justify-center">
        {isHome ? <Lock className="text-white/30" size={36}/> : <Flame className="text-white/30" size={36}/>}
      </div>
      <div>
        {isHome ? (
          <>
            <h1 className="text-4xl md:text-6xl font-black text-white tracking-[0.2em] uppercase" style={{fontFamily:'Georgia, serif'}}>
              Chaud Devant
            </h1>
            <h2 className="text-xl md:text-3xl font-black text-white/50 tracking-widest uppercase mt-3" style={{fontFamily:'Georgia, serif'}}>
              Le site est temporairement fermé.
            </h2>
            <p className="mt-6 text-white/30 text-sm leading-relaxed max-w-sm mx-auto">
              Notre espace famille est en cours de mise à jour.<br/>Revenez très bientôt !
            </p>
          </>
        ) : (
          <>
            <h1 className="text-4xl md:text-6xl font-black text-white tracking-[0.3em] uppercase" style={{fontFamily:'Georgia, serif'}}>
              Ici,
            </h1>
            <h2 className="text-2xl md:text-4xl font-black text-white/50 tracking-widest uppercase mt-2" style={{fontFamily:'Georgia, serif'}}>
              débute le futur.
            </h2>
            {pageName && (
              <p className="mt-6 text-white/20 text-xs uppercase tracking-[0.4em]">{pageName} — bientôt disponible</p>
            )}
          </>
        )}
      </div>
      <div className="w-12 h-px bg-white/10 mx-auto"/>
      <p className="text-white/15 text-xs uppercase tracking-[0.3em]">Revenez bientôt</p>
    </div>
  </div>
);

// ==========================================
// ==========================================
// COMPOSANT WISHLIST
// ==========================================
const WISHLIST_ICONS = ['🎁','🛍️','✨','🏠','👗','📱','🎮','📚','🎵','🧸','🌿','💄','🔧','🍕','✈️','💪','🎨','⌚','💻','🏋️'];

// Hook freemium : renvoie si l'utilisateur courant est premium
const useIsPremium = (userEmail:string|null|undefined, siteUsers:any[]) => {
  const u = siteUsers.find(u=>u.id===userEmail);
  return u?.plan==='pro' || u?.plan==='premium';
};

// Modale freemium générique
const FreemiumModal = ({ config, onClose, onUpgrade }:{config:SiteConfig,onClose:()=>void,onUpgrade:()=>void}) => (
  <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={onClose}>
    <div className="bg-white rounded-t-[2.5rem] md:rounded-[2.5rem] p-8 w-full md:max-w-md shadow-2xl space-y-5" onClick={e=>e.stopPropagation()}>
      <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
      <div className="text-center">
        <div className="text-5xl mb-3">☕</div>
        <h2 className="font-black text-2xl tracking-tight" style={{color:config.primaryColor}}>CHAUD DEVANT</h2>
        <p className="font-black text-lg mt-2">Débloquez tous les services pour<br/>votre gestion familiale</p>
        <p className="text-3xl font-black mt-3" style={{color:config.primaryColor}}>pour 1 CAFÉ par mois !</p>
        <p className="text-xs text-gray-400 mt-1">soit 3,99 € / mois — annulable à tout moment</p>
      </div>
      <div className="space-y-2 bg-gray-50 rounded-2xl p-4">
        {[
          ['🍳','Recettes illimitées + Scans IA illimités'],
          ['🤖','Majordome IA 24h/24 — H24'],
          ['🗓️','Semainier sur 3 mois complets'],
          ['🎁','WishLists infinies, articles illimités'],
          ['🗂️','XSites illimités sans branding'],
          ['📅','Synchronisation Agenda bidirectionnelle'],
        ].map(([icon,label],i)=>(
          <div key={i} className="flex items-center gap-3 text-sm">
            <span className="text-xl w-7 text-center">{icon}</span>
            <span className="font-bold text-gray-700">{label}</span>
          </div>
        ))}
      </div>
      <button onClick={onUpgrade} className="w-full py-4 text-white font-black text-lg rounded-2xl shadow-xl hover:scale-[1.02] transition-transform" style={{backgroundColor:config.primaryColor}}>
        ☕ Débloquer maintenant
      </button>
      <button onClick={onClose} className="w-full py-2 text-gray-400 text-sm font-bold">Pas maintenant</button>
    </div>
  </div>
);

const WishlistView = ({ user, config, siteUsers, onModalChange }: { user:User, config:SiteConfig, siteUsers:any[], onModalChange?:(open:boolean)=>void }) => {
  const isPremium = useIsPremium(user.email, siteUsers);
  const [lists, setLists]     = useState<any[]>([]);
  const [activeList, setActiveList] = useState<any|null>(null);
  const [showCreate, setShowCreate]   = useState(false);
  const [showAddItem, setShowAddItem] = useState<'manual'|'url'|null>(null);
  const [showShare, setShowShare]     = useState(false);
  const [showFreemium, setShowFreemium] = useState(false);
  const [editingList, setEditingList] = useState<any|null>(null);
  const [editingItem, setEditingItem] = useState<any|null>(null);
  const [newList, setNewList]  = useState({name:'', icon:'🎁', category:''});
  const [newItem, setNewItem]  = useState({name:'', imageUrl:'', url:'', price:''});
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError]   = useState('');
  // Cagnotte personnelle
  const [walletBalance, setWalletBalance] = useState<number|null>(null);
  useEffect(()=>{
    if(!user?.email) return;
    const unsub = onSnapshot(doc(db,'user_wallets',user.email), s=>{
      if(s.exists()) setWalletBalance((s.data() as any).balance ?? 0);
      else setWalletBalance(0);
    });
    return()=>unsub();
  },[user]);

  // Notifier le parent quand une modale est ouverte (pour cacher la BottomNav)
  const hasModal = !!(showCreate||showAddItem||showShare||showFreemium||editingList||editingItem);
  useEffect(()=>{ onModalChange?.(hasModal); }, [hasModal]);

  // Toutes les catégories existantes extraites des listes
  const allCategories = Array.from(new Set(lists.map(l=>l.category).filter(Boolean))) as string[];

  // Charger les wishlists (propres + partagées)
  useEffect(()=>{
    if(!user?.email) return;
    const q = query(collection(db,'wishlists'), orderBy('createdAt','desc'));
    const unsub = onSnapshot(q, snap=>{
      const all = snap.docs.map(d=>({id:d.id,...d.data()})) as any[];
      setLists(all.filter((l:any)=> l.ownerEmail===user.email || (l.sharedWith||[]).includes(user.email)));
    });
    return()=>unsub();
  },[user]);

  useEffect(()=>{
    if(!activeList) return;
    const updated = lists.find(l=>l.id===activeList.id);
    if(updated) setActiveList(updated);
  },[lists]);

  const isOwner = (list:any) => list.ownerEmail===user.email;

  const requestUpgrade = async () => {
    await addDoc(collection(db,'notifications'),{
      message:`🚀 Demande Premium de ${user.displayName||user.email} — souhaite passer en version payante !`,
      type:'alert', repeat:'once', targets:[ADMIN_EMAIL],
      createdAt:new Date().toISOString(), readBy:{},
    });
    setShowFreemium(false);
    alert('✅ Demande envoyée ! L\'administrateur vous contactera très bientôt.');
  };

  // Garde freemium : max 1 liste partagée active + max 5 articles
  const canCreateList = () => {
    if(isPremium) return true;
    const sharedActive = lists.filter(l=>l.ownerEmail===user.email && (l.sharedWith||[]).length>0);
    return sharedActive.length < 1 || lists.filter(l=>l.ownerEmail===user.email).length < 1;
  };
  const canAddItem = (list:any) => {
    if(isPremium) return true;
    return (list.items||[]).length < 5;
  };

  const createList = async () => {
    if(!newList.name.trim()) return;
    const docRef = await addDoc(collection(db,'wishlists'),{
      name:newList.name.trim(), icon:newList.icon, category:newList.category.trim(),
      ownerEmail:user.email, ownerName:user.displayName||user.email,
      sharedWith:[], items:[], createdAt:new Date().toISOString()
    });
    setShowCreate(false); setNewList({name:'',icon:'🎁',category:''});
    setActiveList({id:docRef.id, name:newList.name.trim(), icon:newList.icon, category:newList.category.trim(), items:[], ownerEmail:user.email, sharedWith:[]});
  };

  const saveEditList = async () => {
    if(!editingList) return;
    await updateDoc(doc(db,'wishlists',editingList.id),{
      name:editingList.name, icon:editingList.icon, category:editingList.category||''
    });
    setActiveList((a:any)=>a ? {...a, name:editingList.name, icon:editingList.icon, category:editingList.category} : a);
    setEditingList(null);
  };

  const deleteList = async (list:any) => {
    if(!confirm(`Supprimer "${list.name}" ?`)) return;
    await deleteDoc(doc(db,'wishlists',list.id));
    if(activeList?.id===list.id) setActiveList(null);
  };

  const addItemManual = async () => {
    if(!newItem.name.trim()||!activeList) return;
    const item = {id:Date.now().toString(), name:newItem.name.trim(), imageUrl:newItem.imageUrl.trim(), url:newItem.url, price:newItem.price.trim(), addedAt:new Date().toISOString()};
    await updateDoc(doc(db,'wishlists',activeList.id),{items:arrayUnion(item)});
    setNewItem({name:'',imageUrl:'',url:'',price:''}); setShowAddItem(null);
  };

  const saveEditItem = async () => {
    if(!editingItem||!activeList) return;
    const updated = (activeList.items||[]).map((i:any)=>i.id===editingItem.id ? editingItem : i);
    await updateDoc(doc(db,'wishlists',activeList.id),{items:updated});
    setEditingItem(null);
  };

  // Scrape URL via extractProductFromUrl (Gemini Search Grounding + fallbacks)
  const scrapeUrl = async () => {
    if(!urlInput.trim()) return;
    setUrlLoading(true); setUrlError('🔍 Extraction en cours…');
    try {
      const { extractProductFromUrl } = await import('./services/geminiService');
      const result = await extractProductFromUrl(urlInput.trim());
      if(result?.name) {
        setNewItem({name: result.name, imageUrl: result.imageUrl || '', url: urlInput.trim(), price: result.price || ''});
        setShowAddItem('manual');
        setUrlInput(''); setUrlError('');
      } else {
        setNewItem({name: '', imageUrl: '', url: urlInput.trim(), price: ''});
        setShowAddItem('manual');
        setUrlInput('');
        setUrlError("Nom non détecté — saisissez-le manuellement.");
      }
    } catch {
      setNewItem({name: '', imageUrl: '', url: urlInput.trim(), price: ''});
      setShowAddItem('manual');
      setUrlInput(''); setUrlError('');
    }
    setUrlLoading(false);
  };

  const removeItem = async (list:any, itemId:string) => {
    await updateDoc(doc(db,'wishlists',list.id),{items:(list.items||[]).filter((i:any)=>i.id!==itemId)});
  };

  const shareWith = async (list:any, targetEmail:string, targetName:string) => {
    if((list.sharedWith||[]).includes(targetEmail)) return;
    await updateDoc(doc(db,'wishlists',list.id),{sharedWith:arrayUnion(targetEmail)});
    await addDoc(collection(db,'notifications'),{
      message:`${user.displayName||'Quelqu\'un'} a partagé la WishList "${list.name}" ${list.icon} avec toi !`,
      type:'info', repeat:'once', targets:[targetEmail], linkView:'wishlist', createdAt:new Date().toISOString(), readBy:{},
    });
    alert(`✅ WishList partagée avec ${targetName} !`);
  };
  const unshare = async (list:any, targetEmail:string) => {
    await updateDoc(doc(db,'wishlists',list.id),{sharedWith:arrayRemove(targetEmail)});
  };

  // Grouper mes listes par catégorie
  const myLists     = lists.filter(l=>l.ownerEmail===user.email);
  const sharedLists = lists.filter(l=>l.ownerEmail!==user.email);
  const groupedMyLists = myLists.reduce((acc:any, l:any) => {
    const cat = l.category||'Sans catégorie'; if(!acc[cat]) acc[cat]=[]; acc[cat].push(l); return acc;
  }, {});

  return (
    <div className="space-y-6 pb-32 animate-in fade-in">
      {showFreemium&&<FreemiumModal config={config} onClose={()=>setShowFreemium(false)} onUpgrade={requestUpgrade}/>}

      {/* HEADER */}
      <div className="flex items-center justify-between">
        {activeList ? (
          <button onClick={()=>setActiveList(null)} className="flex items-center gap-2 text-gray-500 font-bold hover:text-black transition-colors">
            <ArrowLeft size={20}/> Mes Listes
          </button>
        ) : (
          <h2 className="text-4xl font-black tracking-tight" style={{color:config.primaryColor}}>WISHLISTS</h2>
        )}
        {!activeList&&(
          <button onClick={()=>setShowCreate(true)} className="flex items-center gap-2 px-4 py-2.5 text-white font-black rounded-2xl shadow-lg hover:scale-105 transition-transform text-sm" style={{backgroundColor:config.primaryColor}}>
            <Plus size={16}/>Nouvelle liste
          </button>
        )}
        {activeList&&isOwner(activeList)&&(
          <button onClick={()=>setEditingList({...activeList})} className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-600 rounded-xl font-bold text-xs hover:bg-gray-200 transition-all">
            <Pencil size={13}/>Modifier
          </button>
        )}
      </div>

      {/* WIDGET CAGNOTTE */}
      {(()=>{
        // Calcul du total de toutes les listes visibles (ou liste active)
        const listsToSum = activeList ? [activeList] : lists;
        let total = 0; let count = 0;
        listsToSum.forEach((l:any)=>(l.items||[]).forEach((it:any)=>{
          if(!it.price) return;
          const n = parseFloat(it.price.replace(/[^\d,.]/g,'').replace(',','.'));
          if(!isNaN(n)){ total += n; count++; }
        }));
        const hasTotal = count > 0;
        const afterPurchase = walletBalance !== null ? walletBalance - total : null;
        if(walletBalance === null && !hasTotal) return null;
        return (
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-gradient-to-r from-gray-900 to-gray-800 text-white shadow-xl">
            <div className="text-2xl">🐷</div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/50 mb-0.5">Ma Cagnotte</p>
              <p className="font-black text-lg leading-none">
                {walletBalance !== null ? `${walletBalance.toFixed(2).replace('.',',')} €` : '—'}
              </p>
            </div>
            {hasTotal&&(
              <div className="text-right shrink-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/50 mb-0.5">
                  {activeList ? 'Après achat' : 'Après tout acheter'}
                </p>
                <p className={`font-black text-lg leading-none ${afterPurchase !== null && afterPurchase < 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {afterPurchase !== null ? `${afterPurchase.toFixed(2).replace('.',',')} €` : `−${total.toFixed(2).replace('.',',')} €`}
                </p>
                <p className="text-[10px] text-white/30 mt-0.5">{count} article{count>1?'s':''} · {total.toFixed(2).replace('.',',')} €</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* MODALE CRÉATION */}
      {showCreate&&(
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={()=>setShowCreate(false)}>
          <div className="bg-white rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm shadow-2xl space-y-4" onClick={e=>e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
            <h3 className="font-black text-xl">Nouvelle WishList</h3>
            <div>
              <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Icône</label>
              <div className="flex flex-wrap gap-2">
                {WISHLIST_ICONS.map(icon=>(
                  <button key={icon} onClick={()=>setNewList(l=>({...l,icon}))} className={`text-2xl p-2 rounded-xl transition-all ${newList.icon===icon?'bg-gray-900 scale-110':'bg-gray-100 hover:bg-gray-200'}`}>{icon}</button>
                ))}
              </div>
            </div>
            <input value={newList.name} onChange={e=>setNewList(l=>({...l,name:e.target.value}))} placeholder="Nom de la liste..." className="w-full p-3 rounded-2xl bg-gray-50 font-bold outline-none border-2 border-transparent focus:border-black" autoFocus/>
            {/* Catégorie : dropdown des catégories existantes + créer */}
            <div>
              <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-1.5">Catégorie</label>
              <select
                value={newList.category}
                onChange={e=>{ if(e.target.value==='__new__') { const c=prompt('Nom de la nouvelle catégorie :'); if(c?.trim()) setNewList(l=>({...l,category:c.trim()})); } else setNewList(l=>({...l,category:e.target.value})); }}
                className="w-full p-3 rounded-xl bg-gray-50 font-bold outline-none border-2 border-transparent focus:border-black text-sm"
              >
                <option value="">— Aucune catégorie —</option>
                {allCategories.map(c=><option key={c} value={c}>{c}</option>)}
                <option value="__new__">✚ Créer une catégorie…</option>
              </select>
              {newList.category&&<p className="text-xs text-gray-400 mt-1 ml-1">Catégorie : <strong>{newList.category}</strong></p>}
            </div>
            <div className="flex gap-3">
              <button onClick={()=>setShowCreate(false)} className="flex-1 py-3 bg-gray-100 text-gray-600 font-bold rounded-2xl">Annuler</button>
              <button onClick={createList} disabled={!newList.name.trim()} className="flex-1 py-3 text-white font-black rounded-2xl disabled:opacity-40" style={{backgroundColor:config.primaryColor}}>Créer</button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE ÉDITION LISTE */}
      {editingList&&(
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={()=>setEditingList(null)}>
          <div className="bg-white rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm shadow-2xl space-y-4" onClick={e=>e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
            <h3 className="font-black text-xl">Modifier la WishList</h3>
            <div className="flex flex-wrap gap-2">
              {WISHLIST_ICONS.map(icon=>(
                <button key={icon} onClick={()=>setEditingList((l:any)=>({...l,icon}))} className={`text-2xl p-2 rounded-xl transition-all ${editingList.icon===icon?'bg-gray-900 scale-110':'bg-gray-100 hover:bg-gray-200'}`}>{icon}</button>
              ))}
            </div>
            <input value={editingList.name} onChange={e=>setEditingList((l:any)=>({...l,name:e.target.value}))} className="w-full p-3 rounded-2xl bg-gray-50 font-bold outline-none border-2 border-transparent focus:border-black"/>
            <select
              value={editingList.category||''}
              onChange={e=>{ if(e.target.value==='__new__'){const c=prompt('Nouvelle catégorie :');if(c?.trim())setEditingList((l:any)=>({...l,category:c.trim()}));}else setEditingList((l:any)=>({...l,category:e.target.value})); }}
              className="w-full p-3 rounded-xl bg-gray-50 font-bold outline-none text-sm"
            >
              <option value="">— Aucune catégorie —</option>
              {allCategories.map(c=><option key={c} value={c}>{c}</option>)}
              <option value="__new__">✚ Créer une catégorie…</option>
            </select>
            <div className="flex gap-3">
              <button onClick={()=>setEditingList(null)} className="flex-1 py-3 bg-gray-100 text-gray-600 font-bold rounded-2xl">Annuler</button>
              <button onClick={saveEditList} className="flex-1 py-3 text-white font-black rounded-2xl" style={{backgroundColor:config.primaryColor}}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* VUE LISTE DES WISHLISTS */}
      {!activeList&&(
        <div className="space-y-6">
          {Object.keys(groupedMyLists).length>0&&(
            <div className="space-y-4">
              {Object.entries(groupedMyLists).map(([cat, catLists]:any)=>(
                <div key={cat}>
                  <h3 className="font-black text-xs uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{backgroundColor:config.primaryColor}}/>
                    {cat}
                  </h3>
                  <div className="space-y-2">
                    {catLists.map((list:any)=>(
                      <div key={list.id} onClick={()=>setActiveList(list)} className="flex items-center gap-4 p-4 bg-white rounded-2xl shadow-sm border border-gray-100 cursor-pointer hover:shadow-md hover:scale-[1.01] transition-all group">
                        <div className="text-4xl">{list.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="font-black text-lg leading-tight">{list.name}</div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-[10px] text-gray-400">{(list.items||[]).length} article{(list.items||[]).length!==1?'s':''}</span>
                            {!isPremium&&(list.items||[]).length>=5&&<span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Limite Free</span>}
                            {(list.sharedWith||[]).length>0&&<span className="text-[10px] font-bold text-blue-500 flex items-center gap-1"><Users size={9}/>Partagée</span>}
                          </div>
                        </div>
                        <ChevronRight size={18} className="text-gray-300 group-hover:text-gray-600 transition-colors"/>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {sharedLists.length>0&&(
            <div className="space-y-2">
              <h3 className="font-black text-xs uppercase tracking-widest text-gray-400 flex items-center gap-2"><Users size={12}/>Partagées avec moi</h3>
              {sharedLists.map(list=>(
                <div key={list.id} onClick={()=>setActiveList(list)} className="flex items-center gap-4 p-4 bg-blue-50/70 rounded-2xl border-2 border-blue-200/60 cursor-pointer hover:shadow-md hover:scale-[1.01] transition-all group">
                  <div className="text-4xl">{list.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-black text-lg leading-tight">{list.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full flex items-center gap-1"><Eye size={8}/>Lecture seule</span>
                      <span className="text-[10px] text-gray-500">par {list.ownerName||list.ownerEmail}</span>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-blue-300 group-hover:text-blue-600 transition-colors"/>
                </div>
              ))}
            </div>
          )}
          {lists.length===0&&(
            <div className="text-center py-20 space-y-4">
              <div className="text-6xl">🎁</div>
              <p className="text-gray-400 font-bold">Aucune wishlist pour l'instant</p>
              <p className="text-sm text-gray-300">Créez votre première liste d'envies !</p>
            </div>
          )}
          {!isPremium&&<p className="text-center text-[10px] text-gray-300 italic">Version gratuite · 1 liste partagée max · 5 articles/liste · <button onClick={()=>setShowFreemium(true)} className="underline text-amber-500 font-bold">Débloquer</button></p>}
        </div>
      )}

      {/* VUE DÉTAIL */}
      {activeList&&(
        <div className="space-y-4">
          {(()=>{
            // Calcul du total des prix
            const items: any[] = activeList.items || [];
            let total = 0; let countPriced = 0;
            items.forEach((it:any)=>{
              if(!it.price) return;
              const n = parseFloat(it.price.replace(/[^\d,.]/g,'').replace(',','.'));
              if(!isNaN(n)){ total += n; countPriced++; }
            });
            const totalStr = countPriced > 0 ? total.toFixed(2).replace('.',',') + ' €' : null;
            return (
          <div className={`p-5 rounded-[2.5rem] shadow-xl ${isOwner(activeList)?'bg-white border border-gray-100':'bg-blue-50 border-2 border-blue-200'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-5xl">{activeList.icon}</span>
                <div>
                  <h3 className="font-black text-2xl">{activeList.name}</h3>
                  {activeList.category&&<span className="text-xs text-gray-400 font-bold uppercase tracking-wide">{activeList.category}</span>}
                  {!isOwner(activeList)&&<div className="flex items-center gap-1 mt-1"><Eye size={10} className="text-blue-500"/><span className="text-[10px] text-blue-600 font-bold">Lecture seule · {activeList.ownerName||activeList.ownerEmail}</span></div>}
                  {totalStr&&(
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="text-xs text-gray-400 font-bold">Total</span>
                      <span className="text-base font-black" style={{color:config.primaryColor}}>{totalStr}</span>
                      {countPriced < items.length && <span className="text-[10px] text-gray-300">({countPriced}/{items.length} articles)</span>}
                    </div>
                  )}
                </div>
              </div>
              {isOwner(activeList)&&(
                <div className="flex gap-2">
                  <button onClick={()=>setShowShare(true)} className="p-2.5 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors" title="Partager"><Users size={16}/></button>
                  <button onClick={()=>deleteList(activeList)} className="p-2.5 bg-red-50 text-red-400 rounded-xl hover:bg-red-100 transition-colors" title="Supprimer"><Trash2 size={16}/></button>
                </div>
              )}
            </div>
            {isOwner(activeList)&&(activeList.sharedWith||[]).length>0&&(
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Partagée avec :</span>
                {(activeList.sharedWith||[]).map((email:string)=>{
                  const u=siteUsers.find(u=>u.id===email);
                  return <span key={email} className="flex items-center gap-1.5 bg-blue-100 text-blue-700 text-xs font-bold px-2.5 py-1 rounded-full">{u?.name||email}<button onClick={()=>unshare(activeList,email)} className="hover:text-red-500"><X size={10}/></button></span>;
                })}
              </div>
            )}
          </div>
            );
          })()}

          {/* Partage modale */}
          {showShare&&isOwner(activeList)&&(
            <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={()=>setShowShare(false)}>
              <div className="bg-white rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm shadow-2xl space-y-4" onClick={e=>e.stopPropagation()}>
                <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
                <h3 className="font-black text-xl">Partager "{activeList.name}"</h3>
                <div className="space-y-2">
                  {siteUsers.filter(u=>u.id!==user.email).map((u:any)=>{
                    const already=(activeList.sharedWith||[]).includes(u.id);
                    return (
                      <button key={u.id} onClick={()=>{if(!already){shareWith(activeList,u.id,u.name||u.id);setShowShare(false);}}} className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all ${already?'bg-green-50 border border-green-200 cursor-default':'bg-gray-50 hover:bg-gray-100'}`}>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center font-black text-lg">{u.letter||u.name?.[0]||'?'}</div>
                          <span className="font-bold">{u.name||u.id}</span>
                        </div>
                        {already?<span className="text-xs text-green-600 font-bold flex items-center gap-1"><CheckCircle2 size={14}/>Partagé</span>:<ChevronRight size={16} className="text-gray-400"/>}
                      </button>
                    );
                  })}
                </div>
                <button onClick={()=>setShowShare(false)} className="w-full py-3 bg-gray-100 text-gray-600 font-bold rounded-2xl">Fermer</button>
              </div>
            </div>
          )}

          {/* Boutons ajout */}
          {isOwner(activeList)&&(
            <div className="flex gap-3">
              <button
                onClick={()=>{ if(!canAddItem(activeList)){setShowFreemium(true);return;} setShowAddItem('manual'); }}
                className="flex-1 flex items-center justify-center gap-2 p-4 bg-white rounded-2xl border-2 border-dashed border-gray-300 text-gray-600 font-bold hover:border-black hover:text-black transition-all text-sm"
              >
                <Plus size={16}/>{!isPremium&&(activeList.items||[]).length>=5?'⚠️ Limite atteinte':'Ajout manuel'}
              </button>
              <button
                onClick={()=>{ if(!canAddItem(activeList)){setShowFreemium(true);return;} setShowAddItem('url'); }}
                className="flex-1 flex items-center justify-center gap-2 p-4 bg-white rounded-2xl border-2 border-dashed border-gray-300 text-gray-600 font-bold hover:border-black hover:text-black transition-all text-sm"
              >
                <Link size={16}/>Insérer un lien
              </button>
            </div>
          )}

          {/* Modale ajout manuel */}
          {showAddItem==='manual'&&isOwner(activeList)&&(
            <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={()=>setShowAddItem(null)}>
              <div className="bg-white rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm shadow-2xl space-y-4" onClick={e=>e.stopPropagation()}>
                <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
                <h3 className="font-black text-xl">Ajouter un article</h3>
                <input value={newItem.name} onChange={e=>setNewItem(i=>({...i,name:e.target.value}))} placeholder="Nom du produit..." className="w-full p-3 rounded-2xl bg-gray-50 font-bold outline-none border-2 border-transparent focus:border-black" autoFocus/>
                <div className="flex gap-3">
                  <input value={newItem.price} onChange={e=>setNewItem(i=>({...i,price:e.target.value}))} placeholder="💰 Prix — ex : 24,99 €" className="flex-1 p-3 rounded-2xl bg-amber-50 font-bold outline-none border-2 border-transparent focus:border-amber-400 text-sm" inputMode="decimal"/>
                </div>
                <input value={newItem.imageUrl} onChange={e=>setNewItem(i=>({...i,imageUrl:e.target.value}))} placeholder="URL image (facultatif)..." className="w-full p-3 rounded-2xl bg-gray-50 font-bold outline-none text-sm"/>
                {newItem.imageUrl&&<img src={newItem.imageUrl} alt="" className="w-full h-32 object-cover rounded-2xl" onError={e=>(e.currentTarget.style.display='none')}/>}
                {newItem.url&&<div className="text-xs text-gray-400 truncate bg-gray-50 px-3 py-2 rounded-xl"><Link size={10} className="inline mr-1"/>{newItem.url}</div>}
                <div className="flex gap-3">
                  <button onClick={()=>{setShowAddItem(null);setNewItem({name:'',imageUrl:'',url:'',price:''});setUrlInput('');}} className="flex-1 py-3 bg-gray-100 text-gray-600 font-bold rounded-2xl">Annuler</button>
                  <button onClick={addItemManual} disabled={!newItem.name.trim()} className="flex-1 py-3 text-white font-black rounded-2xl disabled:opacity-40" style={{backgroundColor:config.primaryColor}}>Ajouter</button>
                </div>
              </div>
            </div>
          )}

          {/* Modale URL */}
          {showAddItem==='url'&&isOwner(activeList)&&(
            <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={()=>setShowAddItem(null)}>
              <div className="bg-white rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm shadow-2xl space-y-4" onClick={e=>e.stopPropagation()}>
                <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
                <h3 className="font-black text-xl">Importer depuis un lien</h3>
                <p className="text-sm text-gray-500">Gemini accède à la page et extrait le nom, le prix et l'image.</p>
                <div className="flex gap-2">
                  <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&scrapeUrl()} placeholder="https://amazon.fr/..., ikea.com/..." className="flex-1 p-3 rounded-2xl bg-gray-50 font-bold outline-none border-2 border-transparent focus:border-black text-sm" autoFocus/>
                  <button onClick={scrapeUrl} disabled={!urlInput.trim()||urlLoading} className="p-3 text-white rounded-2xl disabled:opacity-40 flex items-center" style={{backgroundColor:config.primaryColor}}>
                    {urlLoading?<Loader2 size={16} className="animate-spin"/>:<Scan size={16}/>}
                  </button>
                </div>
                {urlLoading&&(
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl">
                      <Loader2 size={14} className="animate-spin text-blue-500 shrink-0"/>
                      <div>
                        <p className="text-xs text-blue-700 font-black">Gemini cherche le produit…</p>
                        <p className="text-[10px] text-blue-500">Étape 1/2 : nom + prix · Étape 2/2 : image (~20s)</p>
                      </div>
                    </div>
                  </div>
                )}
                {urlError&&!urlLoading&&<p className="text-xs text-red-500 font-bold">{urlError}</p>}
                <button onClick={()=>{setShowAddItem(null);setUrlError('');}} className="w-full py-3 bg-gray-100 text-gray-600 font-bold rounded-2xl">Annuler</button>
              </div>
            </div>
          )}

          {/* Modale édition article */}
          {editingItem&&isOwner(activeList)&&(
            <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={()=>setEditingItem(null)}>
              <div className="bg-white rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm shadow-2xl space-y-4" onClick={e=>e.stopPropagation()}>
                <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
                <h3 className="font-black text-xl">Modifier l'article</h3>
                <input value={editingItem.name} onChange={e=>setEditingItem((i:any)=>({...i,name:e.target.value}))} className="w-full p-3 rounded-2xl bg-gray-50 font-bold outline-none border-2 border-transparent focus:border-black" autoFocus/>
                <input value={editingItem.price||''} onChange={e=>setEditingItem((i:any)=>({...i,price:e.target.value}))} placeholder="Prix (ex: 24,99 €)..." className="w-full p-3 rounded-2xl bg-gray-50 font-bold outline-none text-sm border-2 border-transparent focus:border-black"/>
                <input value={editingItem.imageUrl||''} onChange={e=>setEditingItem((i:any)=>({...i,imageUrl:e.target.value}))} placeholder="URL image..." className="w-full p-3 rounded-2xl bg-gray-50 font-bold outline-none text-sm"/>
                <input value={editingItem.url||''} onChange={e=>setEditingItem((i:any)=>({...i,url:e.target.value}))} placeholder="Lien produit..." className="w-full p-3 rounded-2xl bg-gray-50 font-bold outline-none text-sm"/>
                {editingItem.imageUrl&&<img src={editingItem.imageUrl} alt="" className="w-full h-28 object-cover rounded-xl" onError={e=>(e.currentTarget.style.display='none')}/>}
                <div className="flex gap-3">
                  <button onClick={()=>setEditingItem(null)} className="flex-1 py-3 bg-gray-100 text-gray-600 font-bold rounded-2xl">Annuler</button>
                  <button onClick={saveEditItem} className="flex-1 py-3 text-white font-black rounded-2xl" style={{backgroundColor:config.primaryColor}}>Enregistrer</button>
                </div>
              </div>
            </div>
          )}

          {/* Articles */}
          {(activeList.items||[]).length===0?(
            <div className="text-center py-16 space-y-3">
              <div className="text-5xl">{activeList.icon}</div>
              <p className="text-gray-400 font-bold">Liste vide</p>
              {isOwner(activeList)&&<p className="text-sm text-gray-300">Ajoutez votre premier article !</p>}
            </div>
          ):(
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {(activeList.items||[]).map((item:any)=>(
                <div key={item.id} className={`group relative rounded-2xl overflow-hidden shadow-sm border transition-all hover:shadow-md ${isOwner(activeList)?'bg-white border-gray-100':'bg-blue-50/60 border-blue-100'}`}>
                  {item.imageUrl?(
                    <img src={item.imageUrl} alt={item.name} className="w-full h-32 object-cover" onError={e=>{(e.currentTarget as any).style.display='none';}}/>
                  ):(
                    <div className="w-full h-32 bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center text-4xl">{activeList.icon}</div>
                  )}
                  <div className="p-3">
                    <p className="font-bold text-sm leading-tight">{item.name}</p>
                    {item.price&&<p className="text-sm font-black mt-1" style={{color:config.primaryColor}}>{item.price}</p>}
                    {item.url&&<a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 font-bold flex items-center gap-1 mt-1 hover:underline" onClick={e=>e.stopPropagation()}><ExternalLink size={9}/>Voir le produit</a>}
                  </div>
                  {isOwner(activeList)&&(
                    <div className="absolute top-2 right-2 flex gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={()=>setEditingItem({...item})} className="w-7 h-7 bg-white/90 rounded-full flex items-center justify-center text-gray-500 hover:text-black shadow-sm"><Pencil size={10}/></button>
                      <button onClick={()=>removeItem(activeList,item.id)} className="w-7 h-7 bg-white/90 rounded-full flex items-center justify-center text-gray-400 hover:text-red-500 shadow-sm"><X size={10}/></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
// ==========================================
// APP COMPONENT
// ==========================================
const App: React.FC = () => {
  const [user, setUser] = useState<User|null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [config, setConfig] = useState<SiteConfig>(ORIGINAL_CONFIG);
  const [lockedPagesMap, setLockedPagesMap] = useState<Record<string,boolean>>({});
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
  const [showFreemiumModal, setShowFreemiumModal] = useState(false);
  const [wishlistModalOpen, setWishlistModalOpen] = useState(false);

  // Helper : l'utilisateur courant est-il premium ?
  const isCurrentUserPremium = () => {
    if(!user?.email) return false;
    const u = siteUsers.find(u=>u.id===user.email);
    return u?.plan==='pro' || u?.plan==='premium';
  };

  // Demande d'upgrade → notif admin
  const requestPremiumUpgrade = async () => {
    await addDoc(collection(db,'notifications'),{
      message:`🚀 Demande Premium de ${user?.displayName||user?.email} — souhaite accéder à la version payante !`,
      type:'alert', repeat:'once', targets:[ADMIN_EMAIL],
      createdAt:new Date().toISOString(), readBy:{},
    });
    setShowFreemiumModal(false);
    alert('✅ Demande envoyée ! L\'administrateur vous contactera très bientôt.');
  };

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
    const unsubM=onSnapshot(doc(db,'site_config','maintenance'),d=>{if(d.exists())setLockedPagesMap(d.data()?.lockedPages||{});else setLockedPagesMap({});},ignoreError);
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
    return()=>{unsubC();unsubM();unsubX();unsubR();unsubE();unsubV();unsubT();unsubU();unsubN();};
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

  const saveConfig=async(c:SiteConfig,saveHistory=false)=>{
    try{
      await setDoc(doc(db,'site_config','main'),c);
      setConfig(c);
      if(saveHistory){
        // On sauvegarde une copie légère sans les gros champs base64/HTML
        const {welcomeImage, cookingHtml, homeHtml, ...lightConfig} = c as any;
        // On garde quand même welcomeImage s'il commence par https:// (URL externe légère)
        const versionConfig = {
          ...lightConfig,
          welcomeImage: (welcomeImage && !welcomeImage.startsWith('data:')) ? welcomeImage : '',
        };
        await addDoc(collection(db,'site_versions'),{name:'Sauvegarde',date:new Date().toISOString(),config:versionConfig});
      }
    }catch(e){console.error(e);}
  };
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
    if(user?.email === ADMIN_EMAIL) return false; // L'admin voit toujours tout
    return !!lockedPagesMap[viewKey];
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
      <h2 className="text-3xl font-bold tracking-tight text-red-800">ACCÈS RESTREINT</h2>
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
          <div className="w-full max-w-sm bg-white h-full p-6 animate-in slide-in-from-right shadow-2xl overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-6">
              <button onClick={()=>setIsNotifOpen(false)} className="p-2 rounded-xl hover:bg-gray-100 transition-colors text-gray-500 hover:text-black"><ArrowLeft size={20}/></button>
              <h3 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Bell className="text-orange-500"/>Notifications</h3>
            </div>
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
            <span className="font-bold text-lg truncate">{selectedXSite.name}</span>
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
      <BottomNav config={config} view={currentView} setView={setCurrentView}
        hidden={isMenuOpen||isNotifOpen||isEventModalOpen||isRecipeModalOpen||showFreemiumModal||wishlistModalOpen}
      />

      <main className="max-w-7xl mx-auto px-3 md:px-6 pt-24 md:pt-28 pb-32 relative z-10">

        {/* ACCUEIL */}
        {currentView==='home'&&(
          isPageLocked('home') ? <MaintenancePage pageName="Accueil" isHome/> : (
          <div className="space-y-16 animate-in fade-in duration-1000" id="top">
            <section className="relative h-[45vh] md:h-[60vh] rounded-[2rem] md:rounded-[3rem] overflow-hidden shadow-2xl group">
              <img src={config.welcomeImage} className="w-full h-full object-cover transition-transform duration-[10s] group-hover:scale-110"/>
              <div className="absolute inset-0 bg-black/40 flex flex-col justify-end p-10">
                <h1 className="text-3xl md:text-8xl font-cinzel font-black text-white leading-none">{config.welcomeTitle}</h1>
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
          )
        )}

        {/* MODALE FREEMIUM GLOBALE */}
        {showFreemiumModal&&<FreemiumModal config={config} onClose={()=>setShowFreemiumModal(false)} onUpgrade={requestPremiumUpgrade}/>}

        {/* HUB */}
        {currentView==='hub'&&(isPageLocked('hub')?<MaintenancePage pageName="Le Tableau"/>:(
          <HubView
            user={user} config={config} usersMapping={usersMapping}
            recipes={recipes}
            isPremium={isCurrentUserPremium()}
            onShowFreemium={()=>setShowFreemiumModal(true)}
            onAddRecipe={(r:any)=>addEntry('family_recipes',r)}
            onAddSemainier={(title:string)=>{
              const today=new Date();
              const dayName=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'][today.getDay()];
              const getWN=(d:Date)=>{const t=new Date(d.valueOf());const dn=(d.getDay()+6)%7;t.setDate(t.getDate()-dn+3);const ft=t.valueOf();t.setMonth(0,1);if(t.getDay()!==4)t.setMonth(0,1+((4-t.getDay())+7)%7);return 1+Math.ceil((ft-t.valueOf())/604800000);};
              const weekKey=`${today.getFullYear()}_W${String(getWN(today)).padStart(2,'0')}`;
              setDoc(doc(db,`semainier_meals`,`${dayName}_Soir_${weekKey}`),{platName:title,participants:['G','P','V'],mealTime:'Soir',day:dayName,weekKey,updatedAt:new Date().toISOString()});
              alert(`✅ "${title}" planifié ce soir !`);
            }}
          />
        ))}

        {/* FRIGO */}
        {currentView==='frigo'&&(
          isPageLocked('frigo') ? <MaintenancePage pageName="Frigo"/> : (
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-4">
              <h2 className="text-2xl md:text-5xl font-black tracking-tight text-center" style={{color:config.primaryColor}}>MON FRIGO</h2>
              <p className="text-gray-500 italic text-sm">Inventaire intelligent & gestion anti-gaspi</p>
            </div>
            <FrigoView user={user} config={config} isPremium={isCurrentUserPremium()} onShowFreemium={()=>setShowFreemiumModal(true)}/>
          </div>
          )
        )}

        {/* PORTE-MONNAIE */}
        {currentView==='wallet'&&(isPageLocked('wallet')?<MaintenancePage pageName="Porte-Monnaie"/>:<WalletView user={user} config={config}/>)}

        {/* WISHLIST */}
        {currentView==='wishlist'&&(
          isPageLocked('wishlist') ? <MaintenancePage pageName="WishLists"/> : (
          <div className="space-y-6" id="wishlist-top">
            <WishlistView user={user} config={config} siteUsers={siteUsers} onModalChange={setWishlistModalOpen}/>
          </div>
          )
        )}

        {/* TÂCHES */}
        {currentView==='tasks'&&(isPageLocked('tasks') ? <MaintenancePage pageName="Tâches"/> : (
          <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-8" id="tasks-table">
            <div className="text-center space-y-4">
              <h2 className="text-2xl md:text-5xl font-black tracking-tight" style={{color:config.primaryColor}}>TÂCHES MÉNAGÈRES</h2>
              <p className="text-gray-500 font-serif italic">{myLetter?`Salut ${myLetter==='G'?'Gabriel':myLetter==='P'?'Pauline':'Valentin'}, à l'attaque !`:"Connecte-toi avec ton compte perso."}</p>
            </div>
            <div className="bg-white/90 backdrop-blur-xl rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/50">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px]">
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
              <h2 className="text-2xl md:text-5xl font-black tracking-tight" style={{color:config.primaryColor}}>CALENDRIER</h2>
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
                      <div className="font-bold text-lg tracking-tight text-gray-800">{ev.title}</div>
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
                    <h2 className="text-2xl md:text-5xl font-black tracking-tight text-center" style={{color:config.primaryColor}}>MES FAVORIS</h2>
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
                  <h2 className="text-3xl font-bold tracking-tight text-gray-400">ACCÈS VERROUILLÉ</h2>
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
              <h2 className="text-2xl md:text-5xl font-black tracking-tight text-center" style={{color:config.primaryColor}}>RECETTES</h2>
              {!isCurrentUserPremium()&&recipes.length>=15?(
                <div className="flex flex-col items-center gap-3">
                  <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-4 py-2 rounded-full font-bold">{recipes.length}/15 recettes (limite gratuite)</div>
                  <button onClick={()=>setShowFreemiumModal(true)} className="flex items-center gap-2 px-8 py-4 text-white rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform shadow-xl" style={{backgroundColor:config.primaryColor}}>☕ Débloquer les recettes illimitées</button>
                </div>
              ):(
                <button onClick={()=>{setCurrentRecipe(defaultRecipeState);setIsRecipeModalOpen(true);}} className="bg-black text-white px-8 py-4 rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform flex items-center gap-3 shadow-xl" style={{backgroundColor:config.primaryColor}}><Plus size={20}/>Ajouter une recette{!isCurrentUserPremium()&&<span className="text-xs opacity-70 font-normal">({recipes.length}/15)</span>}</button>
              )}
            </div>
            <RecipeModal isOpen={isRecipeModalOpen} onClose={setIsRecipeModalOpen} config={config} currentRecipe={currentRecipe} setCurrentRecipe={setCurrentRecipe} updateEntry={updateEntry} addEntry={addEntry}/>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {recipes.length===0&&<p className="text-center col-span-full opacity-50">Aucune recette pour le moment.</p>}
              {recipes.map((r:any)=>(
                <div key={r.id} className="relative group">
                  <div className="absolute top-4 right-4 z-20 flex gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
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
              <SemainierView config={config} recipes={recipes} isPremium={isCurrentUserPremium()} onShowFreemium={()=>setShowFreemiumModal(true)}/>
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
              lockedPagesMap={lockedPagesMap}
              onSaveMaintenance={async (pages:Record<string,boolean>)=>{
                await setDoc(doc(db,'site_config','maintenance'),{lockedPages:pages});
              }}
            />
          ):(
            <div className="max-w-md mx-auto bg-white/80 p-6 md:p-10 rounded-[2rem] md:rounded-[3rem] text-center space-y-8 shadow-xl mt-20">
              <ShieldAlert className="mx-auto text-red-500" size={48}/>
              <h2 className="text-3xl font-bold tracking-tight text-red-500">ACCÈS REFUSÉ</h2>
              <p className="text-gray-500">Seul l'administrateur peut accéder à cette zone.</p>
            </div>
          )
        )}
      </main>
    </div>
  );
};

export default App;
