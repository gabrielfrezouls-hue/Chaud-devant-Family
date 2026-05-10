import React, { useState, useEffect, useRef, useCallback } from 'react';
import { auth, googleProvider, db, GOOGLE_CLIENT_ID } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User, GoogleAuthProvider } from 'firebase/auth';

// Fournisseur OAuth dédié Google Calendar (scope events)
const googleCalendarProvider = new GoogleAuthProvider();
googleCalendarProvider.addScope('https://www.googleapis.com/auth/calendar.events');
googleCalendarProvider.setCustomParameters({ prompt: 'consent', access_type: 'online' });
import {
  collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, updateDoc,
  where, getDoc, getDocs, arrayUnion, arrayRemove
} from 'firebase/firestore';
import {
  Lock, Menu, X, Home, BookHeart, ChefHat, Wallet, PiggyBank, ArrowLeftRight, Crown, Coins,
  Calendar as CalIcon, Settings, Code, Sparkles, Send, History,
  MessageSquare, ChevronRight, LogIn, Loader2, ShieldAlert, RotateCcw, ArrowLeft, Trash2, Pencil, ClipboardList,
  CheckSquare, Square, CheckCircle2, Plus, Minus, Clock, Save, ToggleLeft, ToggleRight, Upload, Image as ImageIcon, Book, Download, TrendingUp, TrendingDown, Percent, Target,
  Map, MonitorPlay, Eye, QrCode, Star, Maximize2, Minimize2, ExternalLink, Link, Copy, LayoutDashboard, ShoppingCart, StickyNote, Users, ShoppingBag, Bell, Mail, CornerDownRight, Store, CalendarClock,
  Refrigerator, Scan, Camera, AlertTriangle, Bot, Flame, Info, Package, Barcode, Brain, Cloud,
  ListTodo, List, LayoutList, CalendarDays, Link2, CheckCheck, Circle
, Receipt , Utensils, PieChart, BarChart2, ClipboardList as QuizIcon, FileText, Share2, SmartphoneIcon as Phone } from 'lucide-react';
import { Recipe, FamilyEvent, ViewType, SiteConfig, SiteVersion } from './types';
import { askAIArchitect, askAIChat, askButlerAgent, scanProductImage, scanTicketDeCaisse, extractRecipeFromUrl, scanRecipeFromImage } from './services/geminiService';
import Background from './components/Background';
import RecipeCard from './components/RecipeCard';

// --- SÉCURITÉ ---
const ADMIN_EMAIL = "gabriel.frezouls@gmail.com";

// ── SYSTÈME DE TOKENS IA ──
// Coût en tokens par opération (calibré pour ~1000 tokens = 1 mois normal)
const TOKEN_COSTS = {
  majordome:       8,   // Chat Majordome IA
  classify:        2,   // Classifier un produit frigo (texte simple)
  scanPhoto:      15,   // Scan photo produit (vision = coûteux)
  scanBarcode:     5,   // Lecture code-barre photo
  extractRecipe:  10,   // Importer une recette depuis URL
  extractProduct: 12,   // Extraire produit pour WishList (url_context)
  architect:      20,   // Architecte IA (gros JSON)
};
const TOKEN_WELCOME   = 1000; // Tokens offerts à l'inscription
const TOKEN_FREE_RESET  = 500;  // Tokens au reset mensuel (gratuit)
const TOKEN_PRO_RESET  = 2000; // Tokens au reset mensuel (premium)

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
const getMonthWeekends = (monthOffset: number = 0) => {
  const today = new Date();
  const target = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year = target.getFullYear(); const month = target.getMonth();
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

const FrigoView = ({ user, config, onNavigate, isPremium, onShowFreemium, consumeTokens }: { user:User, config:SiteConfig, onNavigate?:(v:string)=>void, isPremium?:boolean, onShowFreemium?:()=>void, consumeTokens?:(cost:number)=>Promise<boolean> }) => {
  const [items, setItems] = useState<FrigoItem[]>([]);
  const [learningMap, setLearningMap] = useState<Record<string,{tab:'frigo'|'cellier',category:string}>>({});
  const [frigotab, setFrigotab] = useState<'frigo'|'cellier'>('frigo');
  const [newItem, setNewItem] = useState({ name:'', quantity:1, unit:'pcs', expiryDate:'', hasExpiry:true });
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [isTicketMode, setIsTicketMode] = useState(false);
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
      // Barcode photo = 5 tokens
      const canRun = !consumeTokens || await consumeTokens(5);
      if(!canRun) { setScanMsg('🔥 Tokens insuffisants (5 requis)'); setIsLoading(false); return; }
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

  // Charger la mémoire d'apprentissage (préférences de placement)
  useEffect(() => {
    const unsub = onSnapshot(collection(db,'frigo_learning'), snap => {
      const map: Record<string,{tab:'frigo'|'cellier', category:string}> = {};
      snap.docs.forEach(d => { const data = d.data(); map[d.id] = { tab: data.preferredTab as 'frigo'|'cellier', category: data.preferredCategory || (data.preferredTab === 'frigo' ? 'Primeur' : 'Épicerie Salée') }; });
      setLearningMap(map);
    });
    return () => unsub();
  },[]);

  const SHELF_LIFE: Record<string,number> = {
    'Boucherie/Poisson':3,'Boulangerie':3,'Plat préparé':4,'Restes':4,'Primeur':7,
    'Frais & Crèmerie':10,'Épicerie Salée':90,'Épicerie Sucrée':90,'Boissons':90,'Surgelés':90,'Divers':14,
  };

  // Normalise un nom pour la clé de mémoire (minuscules, sans accents, sans espaces superflus)
  const normalizeName = (name: string) => name.toLowerCase().trim().replace(/\s+/g,'_').replace(/[àâä]/g,'a').replace(/[éèêë]/g,'e').replace(/[îï]/g,'i').replace(/[ôö]/g,'o').replace(/[ùûü]/g,'u').replace(/[^a-z0-9_]/g,'');

  // Déplace un article entre frigo ↔ cellier ET mémorise la préférence
  const moveItem = async (item: FrigoItem) => {
    const isCurrCellier = CELLIER_CATEGORIES.includes(item.category);
    // Destination : si actuellement au cellier → frigo ; si frigo → cellier
    // Pour le frigo, on restaure la catégorie mémorisée (si elle existe) sinon 'Primeur'
    const key = normalizeName(item.name);
    const remembered = learningMap[key];
    let newCategory: string;
    let newTab: 'frigo'|'cellier';
    if(isCurrCellier) {
      // Déplacement cellier → frigo
      // Utiliser la catégorie mémorisée si elle est une catégorie frigo, sinon 'Primeur'
      const restoredCat = remembered?.category && FRIGO_CATEGORIES.includes(remembered.category)
        ? remembered.category : 'Primeur';
      newCategory = restoredCat;
      newTab = 'frigo';
    } else {
      // Déplacement frigo → cellier
      newCategory = 'Épicerie Salée';
      newTab = 'cellier';
    }
    const newGauge = newTab === 'cellier' ? 'plein' : undefined;
    await updateDoc(doc(db,'frigo_items',item.id),{
      category: newCategory,
      ...(newGauge !== undefined ? {gaugeLevel: newGauge} : {gaugeLevel: null}),
    });
    // Mémoriser : tab + catégorie exacte d'origine (avant déplacement) pour pouvoir restaurer
    const categoryToRemember = isCurrCellier ? newCategory : item.category;
    const tabToRemember = newTab;
    await setDoc(doc(db,'frigo_learning',key),{
      name: item.name,
      preferredTab: tabToRemember,
      preferredCategory: categoryToRemember,
      updatedAt: new Date().toISOString()
    });
    setScanMsg(`↕️ "${item.name}" → ${newTab === 'frigo' ? `Frigo (${newCategory})` : 'Cellier'} · Mémorisé !`);
    setTimeout(()=>setScanMsg(''),3500);
  };

  const addItem = async () => {
    if(!newItem.name.trim()) return;
    setIsLoading(true); setScanMsg('⏳ Classification IA...');
    const nameKey = normalizeName(newItem.name);
    try {
      // 1. Vérifier d'abord la mémoire d'apprentissage
      const learnedTab = learningMap[nameKey];
      let category: string;
      let aiResult: any = null;

      if(learnedTab) {
        // Mémoire connue → utiliser la catégorie exacte mémorisée
        category = learnedTab.category;
        setScanMsg(`⭐ "${newItem.name.trim()}" → ${category} (mémorisé)`);
      } else {
        // 2. Classification IA (coût : 2 tokens)
        const canRun = !consumeTokens || await consumeTokens(2);
        if(!canRun) { setScanMsg('🔥 Tokens insuffisants — rechargement mensuel automatique'); setIsLoading(false); return; }
        const { classifyFrigoItem } = await import('./services/geminiService');
        aiResult = await classifyFrigoItem(newItem.name.trim());
        category = aiResult?.category || categorizeShoppingItem(newItem.name);
        // Règle hard : 'Primeur' est TOUJOURS dans le frigo — si l'IA retourne Primeur
        // et que CELLIER_CATEGORIES ne le contient pas, c'est déjà OK.
        // Sécurité supplémentaire : si IA met un produit connu-primeur en catégorie cellier,
        // on vérifie via la liste de mots-clés
        if(CELLIER_CATEGORIES.includes(category)) {
          const nameLC = newItem.name.toLowerCase();
          const primeurKeywords = ['frais','fraîche','fraiche','légume','legume','fruit','salade','herbe','basilic','persil','coriandre','menthe','ciboulette','pomme','poire','banane','citron','orange','mangue','fraise','raisin','kiwi','tomate','carotte','courgette','poireau','oignon','ail','épinard','brocoli','chou','poivron','concombre','aubergine','radis','betterave','céleri','fenouil','asperge','artichaut','avocat','champignon','gingembre','curcuma','aneth','romarin','thym','laurier'];
          if(primeurKeywords.some(kw => nameLC.includes(kw))) {
            category = 'Primeur'; // Forcer frigo pour produits frais évidents
          }
        }
      }

      const isCellier = CELLIER_CATEGORIES.includes(category);
      const expiryDate = (!isCellier && newItem.hasExpiry) ? (newItem.expiryDate || aiResult?.expiryDate || '') : '';
      await addDoc(collection(db,'frigo_items'),{
        ...newItem, name:newItem.name.trim(), category, expiryDate,
        gaugeLevel: isCellier ? 'plein' : undefined,
        addedAt: new Date().toISOString()
      });
      if(!learnedTab) setScanMsg(`✅ "${newItem.name.trim()}" → ${category}${expiryDate?' · péremption '+expiryDate:isCellier?' · Cellier':''}`);
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
    // Vérification quota scan IA
    if(!isPremium) {
      const monthKey = new Date().toISOString().slice(0,7);
      const scanKeyDoc = await getDoc(doc(db,'user_prefs',user.email||'?'));
      const scanData = scanKeyDoc.exists() ? scanKeyDoc.data() : {};
      const scansThisMonth = scanData[`scans_${monthKey}`] || 0;
      if(scansThisMonth >= 5) { if(onShowFreemium) onShowFreemium(); return; }
      await setDoc(doc(db,'user_prefs',user.email||'?'),{[`scans_${monthKey}`]:scansThisMonth+1},{merge:true});
    }
    setIsLoading(true);

    if(isTicketMode) {
      // ── MODE TICKET DE CAISSE ──
      setScanMsg('⏳ Analyse du ticket...');
      try {
        const canRun = !consumeTokens || await consumeTokens(15);
        if(!canRun) { setScanMsg('🔥 Tokens insuffisants (15 requis)'); setIsLoading(false); return; }
        const items = await scanTicketDeCaisse(file);
        if(items.length > 0) {
          let added = 0;
          for(const item of items) {
            if(!item.name) continue;
            const nameKey = normalizeName(item.name);
            const learnedTab = learningMap[nameKey];
            const category = learnedTab ? learnedTab.category : (item.category || 'Épicerie Salée');
            const isCellier = CELLIER_CATEGORIES.includes(category);
            await addDoc(collection(db,'frigo_items'),{
              name: item.name, category,
              expiryDate: isCellier ? '' : (item.expiryDate||''),
              gaugeLevel: isCellier ? 'plein' : undefined,
              quantity: 1, unit: 'pcs', addedAt: new Date().toISOString()
            });
            added++;
          }
          setScanMsg(`✅ ${added} produit${added>1?'s':''} ajouté${added>1?'s':''} depuis le ticket`);
        } else {
          setScanMsg('❌ Aucun produit alimentaire détecté sur le ticket.');
        }
      } catch { setScanMsg('❌ Erreur analyse du ticket.'); }
    } else {
      // ── MODE PRODUIT UNIQUE ──
      setScanMsg('⏳ Analyse IA...');
      try {
        const canRun = !consumeTokens || await consumeTokens(15);
        if(!canRun) { setScanMsg('🔥 Tokens insuffisants (15 requis)'); setIsLoading(false); return; }
        const result = await scanProductImage(file);
        if(result?.name) {
          const nameKey = normalizeName(result.name);
          const learnedTab = learningMap[nameKey];
          const category = learnedTab ? learnedTab.category : (result.category||categorizeShoppingItem(result.name));
          const isCellier = CELLIER_CATEGORIES.includes(category);
          await addDoc(collection(db,'frigo_items'),{
            name:result.name, category,
            expiryDate:isCellier?'':(result.expiryDate||''),
            gaugeLevel:isCellier?'plein':undefined, quantity:1, unit:'pcs', addedAt:new Date().toISOString()
          });
          setScanMsg(`✅ "${result.name}" (${category})${learnedTab?' ⭐':''}`);
        } else setScanMsg('❌ Non reconnu.');
      } catch { setScanMsg('❌ Erreur analyse.'); }
    }
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
          <div className="modal-glass rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm space-y-4" onClick={e=>e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
            <h3 className="font-black text-xl flex items-center gap-2"><ShoppingCart size={18}/>Ajouter aux Courses</h3>
            <input
              autoFocus value={hubQuickName}
              onChange={e=>setHubQuickName(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&addToHubQuick()}
              placeholder="Ex: Lait, tomates..."
              className="w-full p-4 rounded-2xl bg-white/35 font-bold outline-none border-2 border-transparent focus:border-black"
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
      <div className="flex gap-2 bg-white/30 p-1.5 rounded-2xl backdrop-blur-sm">
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
      <div className="glass-panel p-4 space-y-3">
        <h3 className="font-black uppercase tracking-widest text-gray-400 text-xs flex items-center gap-2"><Plus size={14}/> AJOUTER UN PRODUIT</h3>

        {/* Ligne 1 : Nom + qté + unité */}
        <div className="flex gap-2">
          <input value={newItem.name} onChange={e=>setNewItem({...newItem,name:e.target.value})} onKeyDown={e=>e.key==='Enter'&&addItem()} placeholder="Nom du produit..." className="flex-1 min-w-0 p-3 bg-white/35 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-black transition-colors text-sm"/>
          <input type="number" value={newItem.quantity} onChange={e=>setNewItem({...newItem,quantity:parseInt(e.target.value)||1})} className="w-14 p-3 bg-white/35 rounded-2xl font-bold text-center outline-none text-sm shrink-0" min={1}/>
          <select value={newItem.unit} onChange={e=>setNewItem({...newItem,unit:e.target.value})} className="p-3 bg-white/35 rounded-2xl font-bold outline-none text-sm shrink-0">
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
              <input type="date" value={newItem.expiryDate} onChange={e=>setNewItem({...newItem,expiryDate:e.target.value})} className="flex-1 min-w-0 p-2.5 bg-white/35 rounded-xl font-bold text-xs outline-none"/>
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
              <input type="date" value={newItem.expiryDate} onChange={e=>setNewItem({...newItem,expiryDate:e.target.value})} className="flex-1 min-w-0 p-2.5 bg-white/35 rounded-xl font-bold text-xs outline-none"/>
            )}
            <button onClick={addItem} disabled={isLoading} className="px-4 py-2.5 bg-black text-white rounded-2xl font-bold hover:scale-105 transition-transform shrink-0 disabled:opacity-50 flex items-center gap-1">
              {isLoading?<Loader2 size={15} className="animate-spin"/>:<Plus size={15}/>}
              <span className="text-xs">Ajouter</span>
            </button>
          </div>
        )}

        {/* Scan codes-barre + IA Photo */}
        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <input value={barcodeInput} onChange={e=>setBarcodeInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&fetchProductByBarcode(barcodeInput)} placeholder="Code-barre..." className="flex-1 min-w-0 p-2.5 bg-white/35 rounded-xl font-mono text-xs outline-none border-2 border-transparent focus:border-blue-400"/>
          <input ref={barcodePhotoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleBarcodePhoto}/>
          <button onClick={()=>{barcodeInput.trim()?fetchProductByBarcode(barcodeInput):barcodePhotoRef.current?.click();}} disabled={isLoading} className="p-2.5 bg-blue-500 text-white rounded-xl hover:scale-105 transition-transform shrink-0 disabled:opacity-50 flex items-center gap-1">
            {isLoading?<Loader2 size={14} className="animate-spin"/>:barcodeInput.trim()?<Barcode size={14}/>:<Camera size={14}/>}
            <span className="text-[10px] font-bold hidden sm:block">{barcodeInput.trim()?'Valider':'Scanner'}</span>
          </button>
          <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoFile}/>
          <button
            onClick={()=>{setIsTicketMode(false); photoInputRef.current?.click();}}
            disabled={isLoading}
            className="p-2.5 bg-purple-500 text-white rounded-xl hover:scale-105 transition-transform disabled:opacity-50 flex items-center gap-1.5"
            title="Scanner un produit"
          >
            {isLoading&&!isTicketMode?<Loader2 size={14} className="animate-spin"/>:<Brain size={14}/>}
            <span className="text-[10px] font-bold hidden sm:block">Produit</span>
          </button>
          <button
            onClick={()=>{setIsTicketMode(true); photoInputRef.current?.click();}}
            disabled={isLoading}
            className="p-2.5 bg-orange-500 text-white rounded-xl hover:scale-105 transition-transform disabled:opacity-50 flex items-center gap-1.5"
            title="Scanner un ticket de caisse"
          >
            {isLoading&&isTicketMode?<Loader2 size={14} className="animate-spin"/>:<Receipt size={14}/>}
            <span className="text-[10px] font-bold hidden sm:block">Ticket</span>
          </button>
        </div>
        {scanMsg&&<div className={`text-center text-xs font-bold py-2 px-3 rounded-xl leading-tight ${scanMsg.startsWith('✅')?'bg-green-50 text-green-700':scanMsg.startsWith('⏳')?'bg-blue-50 text-blue-700':'bg-red-50 text-red-700'}`}>{scanMsg}</div>}
      </div>

      {/* INVENTAIRE FRIGO */}
      {frigotab==='frigo'&&(
        <div className="glass-panel p-6">
          <h3 className="font-black uppercase tracking-widest text-gray-400 text-xs flex items-center gap-2 mb-6"><Refrigerator size={14}/> INVENTAIRE FRIGO ({frigoItems.length})</h3>
          {frigoItems.length===0&&<div className="text-center py-12 text-gray-300 italic">Frigo vide !</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {frigoItems.map(item=>{
              const expStatus=getExpiryStatus(item);
              return (
                <div key={item.id} className={`group flex justify-between items-center p-4 rounded-2xl border-l-4 transition-all hover:shadow-md glass-element ${expStatus?.icon==='🔴'?'!bg-red-50/60 border-red-400':expStatus?.icon==='🟠'?'!bg-orange-50/60 border-orange-400':'border-white/40'}`}>
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
                    <button
                      onClick={()=>moveItem(item)}
                      className="opacity-30 group-hover:opacity-100 p-1.5 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition-all"
                      title="Déplacer au Cellier (mémoriser)"
                    ><ArrowLeftRight size={13}/></button>
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
        <div className="glass-panel p-6">
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
                      <button
                        onClick={()=>moveItem(item)}
                        className="opacity-30 group-hover:opacity-100 p-1.5 bg-blue-50 text-blue-500 rounded-lg hover:bg-blue-100 transition-all"
                        title="Déplacer au Frigo (mémoriser)"
                      ><ArrowLeftRight size={12}/></button>
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
const MajordomeChat = ({ user, config, hubItems, addHubItem, recipes, onAddRecipe, onAddSemainier, isPremium, onShowFreemium, consumeTokens }: { user:User, config:SiteConfig, hubItems:any[], addHubItem:(content:string)=>void, recipes?:any[], onAddRecipe?:(r:any)=>void, onAddSemainier?:(title:string)=>void, isPremium?:boolean, onShowFreemium?:()=>void, consumeTokens?:(cost:number)=>Promise<boolean> }) => {
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

    // Garde tokens (8 tokens par message Majordome)
    if(consumeTokens) {
      const ok = await consumeTokens(8);
      if(!ok) {
        setMessages(prev => [...prev, { role:'assistant' as const, text:'🔥 Tokens IA insuffisants. Votre solde se recharge automatiquement chaque mois (500 en gratuit, 2000 en premium).' }]);
        return;
      }
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

  // Plus de quota hebdomadaire — remplacé par le système de tokens global

  return (
    <>
      <button onClick={()=>setIsOpen(true)} className="fixed bottom-28 md:bottom-8 right-6 z-50 w-14 h-14 rounded-full text-white shadow-2xl flex items-center justify-center hover:scale-110 transition-transform relative" style={{backgroundColor:config.primaryColor}}>
        <Bot size={24}/>
        {/* Badge tokens géré dans la navbar principale */}
      </button>

      {isOpen&&(
        <div className="fixed bottom-28 md:bottom-8 right-6 z-[80] w-80 md:w-96 modal-glass rounded-3xl border border-gray-100 flex flex-col" style={{height:'520px'}}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100 rounded-t-3xl" style={{backgroundColor:config.primaryColor}}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center"><Bot size={16} className="text-white"/></div>
              <div>
                <div className="font-black text-white text-sm">LE MAJORDOME</div>
                <div className="text-white/60 text-[10px]">
                  {'Conseiller IA — Recettes, Courses, Frigo'}
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
            {isLoading&&<div className="flex"><div className="bg-white/35 p-3 rounded-2xl rounded-tl-sm"><div className="flex gap-1">{[0,1,2].map(i=><div key={i} className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:`${i*0.15}s`}}/>)}</div></div></div>}
          </div>

          <div className="p-4 border-t border-gray-100 flex gap-2">
            <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="Demandez au Majordome..." className="flex-1 p-3 bg-white/35 rounded-xl text-sm font-bold outline-none"/>
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
const HubView = ({ user, config, usersMapping, recipes, onAddRecipe, onAddSemainier, isPremium, onShowFreemium, consumeTokens }: { user:User, config:SiteConfig, usersMapping:any, recipes?:any[], onAddRecipe?:(r:any)=>void, onAddSemainier?:(title:string)=>void, isPremium?:boolean, onShowFreemium?:()=>void, consumeTokens?:(cost:number)=>Promise<boolean> }) => {
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
          <div className="modal-glass rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm space-y-4" onClick={e=>e.stopPropagation()}>
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
              className="w-full p-4 rounded-2xl bg-white/35 font-bold outline-none border-2 border-transparent focus:border-black transition-colors"
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
      <div className="glass-panel p-6 md:sticky md:top-24 z-30" id="hub-input">
        <div className="flex gap-2 mb-4 justify-center">
          <button onClick={()=>setInputType('shop')} className={`flex-1 py-3 rounded-xl font-bold text-xs uppercase transition-all ${inputType==='shop'?'bg-orange-500 text-white shadow-lg scale-105':'bg-gray-100 text-gray-400'}`}><ShoppingCart size={16} className="inline mr-2"/>Course</button>
          <button onClick={()=>setInputType('note')} className={`flex-1 py-3 rounded-xl font-bold text-xs uppercase transition-all ${inputType==='note'?'bg-yellow-400 text-white shadow-lg scale-105':'bg-gray-100 text-gray-400'}`}><StickyNote size={16} className="inline mr-2"/>Note</button>
          <button onClick={()=>setInputType('msg')} className={`flex-1 py-3 rounded-xl font-bold text-xs uppercase transition-all ${inputType==='msg'?'bg-blue-500 text-white shadow-lg scale-105':'bg-gray-100 text-gray-400'}`}><MessageSquare size={16} className="inline mr-2"/>Msg</button>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input value={newItem} onChange={e=>setNewItem(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addItem()} placeholder={inputType==='shop'?"Ex: Lait, Beurre...":"Message..."} className="flex-1 p-4 rounded-2xl bg-white/35 font-bold outline-none border-2 border-transparent focus:border-black transition-colors"/>
            <button onClick={()=>addItem()} className="p-4 bg-black text-white rounded-2xl hover:scale-105 transition-transform"><Plus/></button>
          </div>
          {inputType==='shop'&&(
            <div className="relative">
              <div className="flex items-center bg-white/35 rounded-xl px-4 border border-gray-200">
                <Store size={16} className="text-gray-400 mr-2"/>
                <input value={storeSearch} onFocus={()=>setShowStoreList(true)} onChange={e=>{setStoreSearch(e.target.value);setSelectedStore(e.target.value);}} placeholder="Rechercher un magasin..." className="w-full py-3 bg-transparent text-xs font-bold outline-none text-gray-600"/>
              </div>
              {showStoreList&&storeSearch&&(
                <div className="absolute top-full left-0 right-0 glass-element rounded-xl mt-1 max-h-48 overflow-y-auto z-50">
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
        consumeTokens={consumeTokens}
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
          <div className="flex flex-col md:flex-row gap-4 items-end bg-white/35 p-6 rounded-3xl">
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
            <div className="bg-white p-6 rounded-[2rem] shadow-lg border border-gray-100"><h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2"><ClipboardList size={14}/> Tâches Rémunérées</h3><div className="flex gap-2 mb-4"><input value={newTask} onChange={e=>setNewTask(e.target.value)} placeholder="Ajouter une tâche..." className="flex-1 bg-white/35 rounded-xl px-3 text-sm font-bold outline-none"/><button onClick={addWalletTask} className="p-2 bg-gray-200 rounded-xl"><Plus size={16}/></button></div><div className="space-y-2 max-h-40 overflow-y-auto">{(myWallet.tasks||[]).map((t:any)=>(<div key={t.id} className="flex items-center gap-3 group"><button onClick={()=>toggleWalletTask(t.id)}>{t.done?<CheckCircle2 size={16} className="text-green-500"/>:<Square size={16} className="text-gray-300"/>}</button><span className={`text-sm font-bold flex-1 ${t.done?'line-through text-gray-300':'text-gray-600'}`}>{t.text}</span><button onClick={()=>deleteWalletTask(t.id)} className="opacity-0 group-hover:opacity-100 text-red-300"><X size={14}/></button></div>))}</div></div>
          </div>
          <div className="lg:col-span-2 space-y-6">
            <div className="glass-panel p-6 rounded-[2.5rem] h-80 relative" id="wallet-graph"><div className="flex justify-between items-center mb-4"><h3 className="text-xs font-black uppercase tracking-widest text-gray-400">Évolution du Solde</h3><div className="flex bg-gray-100 p-1 rounded-lg">{(['1M','1Y','5Y'] as const).map(range=>(<button key={range} onClick={()=>setChartRange(range)} className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${chartRange===range?'bg-white shadow text-black':'text-gray-400'}`}>{range}</button>))}</div></div><div className="h-60 w-full p-2"><SimpleLineChart data={graphData} color={config.primaryColor}/></div></div>
            <div className="glass-panel p-8 rounded-[2.5rem]"><div className="flex justify-between items-center mb-6"><h3 className="text-xs font-black uppercase tracking-widest text-gray-400 flex items-center gap-2"><History size={14}/> Historique (Ce Mois)</h3><span className="text-[10px] font-bold bg-gray-100 px-3 py-1 rounded-full text-gray-500">{new Date().toLocaleString('default',{month:'long'})}</span></div><div className="space-y-4 max-h-60 overflow-y-auto pr-2">{currentMonthHistory.length===0&&<div className="text-center text-gray-300 italic py-4">Aucun mouvement ce mois-ci</div>}{currentMonthHistory.slice().reverse().map((h:any,i:number)=>(<div key={i} className="flex justify-between items-center p-3 bg-white/35 rounded-2xl"><div className="flex items-center gap-3"><div className={`p-2 rounded-full ${h.amount>0?'bg-green-100 text-green-600':'bg-red-100 text-red-600'}`}>{h.amount>0?<TrendingUp size={16}/>:<TrendingDown size={16}/>}</div><div className="text-xs font-bold text-gray-400 uppercase">{new Date(h.date).toLocaleDateString()}</div></div><span className={`font-black ${h.amount>0?'text-green-600':'text-red-600'}`}>{h.amount>0?'+':''}{h.amount}€</span></div>))}</div></div>
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

// ── Grille calendrier mensuelle (composant séparé pour les hooks) ──
const CalendarTableGrid = ({ allItems, today, config, delItem }: {
  allItems: any[], today: string, config: SiteConfig,
  delItem: (col: string, id: string) => Promise<void>
}) => {
  const [tableOffset, setTableOffset] = React.useState(0);
  const viewDate = new Date();
  viewDate.setMonth(viewDate.getMonth() + tableOffset);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = (firstDay.getDay() + 6) % 7;
  const JOURS = ['L','M','M','J','V','S','D'];
  const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const cells: (number|null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({length: daysInMonth}, (_,i) => i+1)
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({length: cells.length/7}, (_,i) => cells.slice(i*7, i*7+7));

  return (
    <div className="space-y-4">
      {/* Navigation mois */}
      <div className="flex items-center justify-between">
        <button onClick={()=>setTableOffset(o=>o-1)}
          className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-all">
          <ArrowLeft size={16}/>
        </button>
        <span className="font-black text-lg tracking-tight">{MOIS_FR[month]} {year}</span>
        <button onClick={()=>setTableOffset(o=>o+1)}
          className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-all">
          <ArrowLeft size={16} className="rotate-180"/>
        </button>
      </div>
      {/* Grille */}
      <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
        {/* En-têtes */}
        <div className="grid grid-cols-7 border-b border-gray-100">
          {JOURS.map((j,i) => (
            <div key={i} className={`py-2 text-center text-[10px] font-black uppercase tracking-widest ${i>=5?'text-gray-300':'text-gray-400'}`}>{j}</div>
          ))}
        </div>
        {/* Semaines */}
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-gray-50 last:border-0">
            {week.map((day, dow) => {
              if(!day) return <div key={dow} className="min-h-[72px] bg-gray-50/30"/>;
              const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
              const isToday = dateStr === today;
              const isWeekend = dow >= 5;
              const dayItems = allItems.filter(i => i.date === dateStr);
              return (
                <div key={dow} className={`min-h-[72px] p-1.5 border-r border-gray-50 last:border-0 ${
                  isToday ? 'bg-blue-50/70' : isWeekend ? 'bg-gray-50/50' : 'bg-white hover:bg-gray-50/40'
                }`}>
                  <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-black mb-1 ${
                    isToday ? 'text-white' : 'text-gray-600'
                  }`} style={isToday ? {backgroundColor:config.primaryColor} : {}}>
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {dayItems.slice(0,2).map(item => (
                      <div key={item.id} title={item.title}
                        className={`text-[9px] font-bold px-1 py-0.5 rounded-md truncate leading-tight ${
                          item._type==='event' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                        {item.title}
                      </div>
                    ))}
                    {dayItems.length > 2 && <div className="text-[8px] text-gray-400 font-bold pl-1">+{dayItems.length-2}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {/* Légende */}
      <div className="flex gap-4 justify-center text-[10px] font-bold text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-100 inline-block"/>Événements</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-100 inline-block"/>Tâches</span>
      </div>
    </div>
  );
};


// ══════════════════════════════════════════════════════════════
// CALENDAR VIEW — Événements + Tâches + Tableau + Google Agenda
// ══════════════════════════════════════════════════════════════
const CalendarView = ({ user, config, events, addEntry, deleteItem: delItem, siteUsers }: {
  user: User, config: SiteConfig,
  events: FamilyEvent[],
  addEntry: (col: string, data: any) => Promise<void>,
  deleteItem: (col: string, id: string) => Promise<void>,
  siteUsers?: any[]
}) => {
  const [calTab, setCalTab] = React.useState<'events'|'tasks'|'table'>('events');
  const [showEventForm, setShowEventForm] = React.useState(false);
  const [showTaskForm, setShowTaskForm] = React.useState(false);
  const [gcalLinked, setGcalLinked] = React.useState(false);
  const [tasks, setTasks] = React.useState<any[]>([]);
  const [newEvt, setNewEvt] = React.useState({ title:'', date: new Date().toISOString().split('T')[0], time:'', isAllDay: true });
  const [newTask, setNewTask] = React.useState({ title:'', date: new Date().toISOString().split('T')[0], time:'', hasTime:false, done: false });
  const [submitting, setSubmitting] = React.useState(false);
  const [pastEventsOpen, setPastEventsOpen] = React.useState(false);
  const [pastTasksOpen, setPastTasksOpen] = React.useState(false);
  const [syncingAll, setSyncingAll] = React.useState(false);
  // Participants sélectionnés pour le push gcal (par défaut tous)
  const allUserEmails = (siteUsers||[]).map((u:any) => u.id).filter(Boolean);
  const [selectedParticipants, setSelectedParticipants] = React.useState<string[]>(allUserEmails);
  // Synchro liste participants quand siteUsers change
  React.useEffect(() => {
    const emails = (siteUsers||[]).map((u:any) => u.id).filter(Boolean);
    setSelectedParticipants(emails);
  }, [JSON.stringify(siteUsers)]);

  // Vérifier si agenda lié : localStorage ET Firestore (persiste entre sessions)
  React.useEffect(() => {
    if (!user?.email) return;
    // Vérification initiale depuis Firestore
    getDoc(doc(db, 'gcal_links', user.email)).then(snap => {
      if (snap.exists() && snap.data()?.linked) {
        setGcalLinked(true); // Le compte a été lié un jour
      } else {
        setGcalLinked(!!getGcalToken());
      }
    }).catch(() => setGcalLinked(!!getGcalToken()));
    // Recheck token local toutes les 30s
    const timer = setInterval(() => setGcalLinked(!!getGcalToken()), 30000);
    return () => clearInterval(timer);
  }, [user?.email]);

  // Charger les tâches depuis Firestore
  React.useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'family_tasks'), orderBy('date', 'asc')),
      snap => setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return () => unsub();
  }, []);

  const handleLierAgenda = async () => {
    const ok = await lierAgenda(user.email!);
    setGcalLinked(ok && !!getGcalToken());
  };

  const handleAddEvent = async () => {
    if (!newEvt.title || !newEvt.date) return;
    setSubmitting(true);
    await addEntry('family_events', {
      title: newEvt.title,
      date: newEvt.date,
      time: newEvt.isAllDay ? null : newEvt.time,
      participants: selectedParticipants,
    });
    // Push vers Google Calendar du créateur si connecté
    // Push vers Google Agenda de tous les participants
{
  const desc = selectedParticipants.length > 0
    ? `Depuis Chaud Devant 🔥 · Participants: ${selectedParticipants.join(', ')}`
    : 'Depuis Chaud Devant 🔥';
  const dateIso = newEvt.isAllDay
    ? `${newEvt.date}T00:00:00`
    : `${newEvt.date}T${(newEvt.time||'09:00').replace('h',':')}:00`;
  // Participants autres que le créateur courant
  const otherParticipants = selectedParticipants.filter(e => e !== user.email);
  await pushEventToAllParticipants(
    { titre: newEvt.title, dateIso, description: desc, allDay: newEvt.isAllDay },
    otherParticipants
  );
}
    setNewEvt({ title:'', date: new Date().toISOString().split('T')[0], time:'', isAllDay:true });
    setShowEventForm(false);
    setSubmitting(false);
  };

  const handleAddTask = async () => {
    if (!newTask.title || !newTask.date) return;
    setSubmitting(true);
    await addEntry('family_tasks', {
      title: newTask.title,
      date: newTask.date,
      time: newTask.hasTime ? newTask.time : null,
      done: false,
      createdBy: user.email,
      participants: selectedParticipants,
    });
    // Push vers Google Agenda de tous les participants
{
  const otherParticipants = selectedParticipants.filter(e => e !== user.email);
  if(newTask.hasTime && newTask.time) {
    const dateTime = `${newTask.date}T${newTask.time}:00`;
    await pushEventToAllParticipants(
      { titre: `☑ ${newTask.title}`, dateIso: dateTime, description: 'Tâche Chaud Devant 🔥', allDay: false },
      otherParticipants
    );
  } else {
    // Tâche toute la journée
    if(gcalLinked) await pousserTacheVersGoogleCalendar(newTask.title, newTask.date);
    const otherWithGcal = otherParticipants;
    if(otherWithGcal.length > 0) {
      await pushEventToAllParticipants(
        { titre: `☑ ${newTask.title}`, dateIso: `${newTask.date}T00:00:00`, description: 'Tâche Chaud Devant 🔥', allDay: true },
        otherWithGcal
      );
    }
  }
}
    setNewTask({ title:'', date: new Date().toISOString().split('T')[0], time:'', hasTime:false, done: false });
    setShowTaskForm(false);
    setSubmitting(false);
  };
// Pousse un événement vers le gcal de TOUS les participants qui ont lié leur compte
// Mécanisme : stocke des "gcal_pending_events" dans Firestore par participant.
// Chaque utilisateur les exécute avec son propre token au login/reconnexion.
const pushEventToAllParticipants = async (
  eventData: { titre: string; dateIso: string; description?: string; allDay?: boolean },
  participantEmails: string[]
) => {
  // D'abord, pousser pour l'utilisateur courant si son token est valide
  const currentToken = getGcalToken();
  if (currentToken) {
    await pousserVersGoogleCalendar(eventData.titre, eventData.dateIso, eventData.description, eventData.allDay);
  }
  // Créer des entrées "en attente" dans Firestore pour les autres participants
  const pendingRef = collection(db, 'gcal_pending_events');
  for (const email of participantEmails) {
    // Vérifier si cet utilisateur a lié son Google Agenda
    try {
      const linkedDoc = await getDoc(doc(db, 'gcal_links', email));
      if (linkedDoc.exists() && linkedDoc.data()?.linked) {
        // Stocker un événement en attente pour cet utilisateur
        await addDoc(pendingRef, {
          targetEmail: email,
          ...eventData,
          createdAt: new Date().toISOString(),
          processed: false,
        });
      }
    } catch { /* silencieux */ }
  }
};
  const toggleTask = async (task: any) => {
    await updateDoc(doc(db, 'family_tasks', task.id), { done: !task.done });
  };

  // Synchroniser les events existants (créés avant la connexion Google)
  const syncAllEventsToGcal = async () => {
    if (!gcalLinked) return;
    setSyncingAll(true);
    const futureEvents = events.filter(e => e.date >= today);
    for (const ev of futureEvents) {
      const dateTime = ev.time ? `${ev.date}T${ev.time.replace('h',':')}:00` : `${ev.date}T12:00:00`;
      await pousserVersGoogleCalendar(ev.title, dateTime, 'Depuis Chaud Devant 🔥 (sync)');
      await new Promise(r => setTimeout(r, 200)); // éviter rate limit
    }
    const futureTasks = tasks.filter(t => !t.done && t.date >= today);
    for (const t of futureTasks) {
      await pousserTacheVersGoogleCalendar(t.title, t.date);
      await new Promise(r => setTimeout(r, 200));
    }
    setSyncingAll(false);
    alert(`✅ ${futureEvents.length + futureTasks.length} éléments synchronisés avec Google Agenda.`);
  };

  // Fusionner events + tasks pour la vue tableau
  const today = new Date().toISOString().split('T')[0];
  const allItems = [
    ...events.map(e => ({ ...e, _type: 'event' as const })),
    ...tasks.map(t => ({ ...t, _type: 'task' as const })),
  ].sort((a, b) => (a.date > b.date ? 1 : -1));

  const upcomingItems = allItems.filter(i => i.date >= today);
  const pastItems = allItems.filter(i => i.date < today).reverse();

  const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

  return (
    <div className="max-w-3xl mx-auto space-y-6" id="calendar-view">

      {/* ── En-tête + bouton Google Agenda ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl md:text-4xl font-black tracking-tight" style={{color:config.primaryColor}}>CALENDRIER</h2>
        {gcalLinked ? (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-sm bg-green-50 text-green-700 border border-green-200">
              <CheckCheck size={16} className="text-green-600"/>
              <span>Compte connecté</span>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem('gcal_token');
                localStorage.removeItem('gcal_expiry');
                setGcalLinked(false);
              }}
              className="w-8 h-8 rounded-xl bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 flex items-center justify-center transition-all"
              title="Déconnecter l'agenda"
            ><X size={15}/></button>
          </div>
        ) : (
          <button
            onClick={handleLierAgenda}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-sm bg-white border-2 border-gray-200 text-gray-700 hover:border-gray-400 hover:shadow-sm transition-all"
          >
            <Link2 size={16}/><span>Lier mon compte Google</span>
          </button>
        )}
      </div>

      {/* ── Onglets ── */}
      <div className="flex gap-1 bg-white/30 p-1 rounded-2xl backdrop-blur-sm">
        {([
          { id: 'events', label: 'Événements', icon: <CalendarDays size={15}/> },
          { id: 'tasks',  label: 'Tâches',     icon: <ListTodo size={15}/> },
          { id: 'table',  label: 'Tableau',     icon: <LayoutList size={15}/> },
        ] as const).map(tab => (
          <button key={tab.id} onClick={()=>setCalTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-sm transition-all ${
              calTab===tab.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-700'
            }`}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* ══ ONGLET ÉVÉNEMENTS ══ */}
      {calTab === 'events' && (
        <div className="space-y-4">
          <button onClick={()=>setShowEventForm(v=>!v)}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[100px] font-black text-sm text-white shadow-lg hover:scale-[1.01] transition-transform"
            style={{backgroundColor:config.primaryColor}}>
            <Plus size={18}/> Nouvel événement
          </button>

          {showEventForm && (
            <div className="glass-panel p-6 space-y-4 animate-in slide-in-from-top-2">
              <input autoFocus value={newEvt.title} onChange={e=>setNewEvt(v=>({...v,title:e.target.value}))}
                placeholder="Titre de l'événement…"
                className="w-full p-3 rounded-xl border border-white/50 bg-white/40 backdrop-blur-sm focus:bg-white/60 focus:border-white/70 font-bold outline-none text-lg transition-all"/>
              <div className="flex gap-3">
                <input type="date" value={newEvt.date} onChange={e=>setNewEvt(v=>({...v,date:e.target.value}))}
                  className="flex-1 p-3 rounded-xl border-2 border-gray-100 focus:border-gray-300 font-bold outline-none cursor-pointer"/>
                <button onClick={()=>setNewEvt(v=>({...v,isAllDay:!v.isAllDay}))}
                  className={`px-4 rounded-xl font-bold text-sm border-2 transition-all ${newEvt.isAllDay?'bg-gray-900 text-white border-gray-900':'bg-white border-gray-200 text-gray-500'}`}>
                  {newEvt.isAllDay ? 'Toute la journée' : 'Heure précise'}
                </button>
              </div>
              {!newEvt.isAllDay && (
                <input type="time" value={newEvt.time} onChange={e=>setNewEvt(v=>({...v,time:e.target.value}))}
                  className="w-full p-3 rounded-xl border-2 border-gray-100 focus:border-gray-300 font-bold outline-none"/>
              )}
              {/* Participants */}
              {(siteUsers||[]).length > 0 && (
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Participants</p>
                  <div className="flex flex-wrap gap-2">
                    {(siteUsers||[]).map((u:any) => {
                      const sel = selectedParticipants.includes(u.id);
                      return (
                        <button key={u.id}
                          onClick={()=>setSelectedParticipants(prev =>
                            sel ? prev.filter(e=>e!==u.id) : [...prev, u.id]
                          )}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all ${
                            sel ? 'border-current text-white' : 'border-gray-200 text-gray-400 bg-white'
                          }`}
                          style={sel ? {backgroundColor:config.primaryColor, borderColor:config.primaryColor} : {}}
                        >
                          <span className="w-5 h-5 rounded-full bg-white/30 flex items-center justify-center font-black text-[10px]">
                            {(u.letter||u.name||u.id||'?')[0].toUpperCase()}
                          </span>
                          {u.name||u.id}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={handleAddEvent} disabled={submitting}
                  className="flex-1 py-3 rounded-2xl font-black text-white text-sm disabled:opacity-50"
                  style={{backgroundColor:config.primaryColor}}>
                  {submitting ? 'Ajout…' : '✓ Ajouter'}
                </button>
                <button onClick={()=>setShowEventForm(false)} className="px-4 py-3 rounded-2xl bg-gray-100 text-gray-500 font-bold text-sm">Annuler</button>
              </div>
            </div>
          )}

          {/* Bouton sync tous les events existants */}
          {gcalLinked && events.filter(e => e.date >= today).length > 0 && (
            <button
              onClick={syncAllEventsToGcal}
              disabled={syncingAll}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-xs font-bold border-2 border-dashed border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600 transition-all disabled:opacity-50"
            >
              <CalendarDays size={14}/>
              {syncingAll ? 'Synchronisation…' : 'Synchroniser tous les événements à venir avec Google Agenda'}
            </button>
          )}

          {/* Événements à venir */}
          <div className="space-y-3">
            {events.filter(e => e.date >= today).length === 0 && events.length === 0 && (
              <p className="text-center text-gray-400 py-10 italic">Aucun événement à venir…</p>
            )}
            {events.filter(e => e.date >= today).map(ev => {
              const d = new Date(ev.date + 'T12:00:00');
              return (
                <div key={ev.id} className="group flex items-center gap-4 p-4 rounded-2xl card-glass transition-all">
                  <div className="w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0"
                    style={{backgroundColor: config.primaryColor+'18', color: config.primaryColor}}>
                    <span className="text-lg font-black leading-none">{d.getDate()}</span>
                    <span className="text-[9px] font-black uppercase">{MONTHS_FR[d.getMonth()]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-800 truncate">{ev.title}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {ev.time && <span className="text-xs text-gray-400 flex items-center gap-1"><Clock size={10}/>{ev.time}</span>}
                      {ev.participants?.length > 0 && (
                        <div className="flex gap-0.5">
                          {ev.participants.map((p:string) => {
                            const u = (siteUsers||[]).find((u:any) => u.id === p);
                            return <span key={p} className="w-4 h-4 rounded-full text-[8px] font-black flex items-center justify-center text-white" style={{backgroundColor:config.primaryColor}}>{(u?.letter||u?.name||p||'?')[0].toUpperCase()}</span>;
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  <button onClick={()=>delItem('family_events',ev.id)}
                    className="opacity-0 group-hover:opacity-100 p-2 text-red-300 hover:text-red-500 rounded-xl transition-all">
                    <Trash2 size={14}/>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Événements passés — menu déroulant */}
          {events.filter(e => e.date < today).length > 0 && (
            <div>
              <button
                onClick={() => setPastEventsOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-white/35 border border-gray-100 text-gray-400 hover:bg-gray-100 transition-all"
              >
                <span className="text-xs font-black uppercase tracking-widest">
                  Événements passés ({events.filter(e => e.date < today).length})
                </span>
                <ArrowLeft size={14} className={`transition-transform ${pastEventsOpen ? '-rotate-90' : 'rotate-180'}`}/>
              </button>
              {pastEventsOpen && (
                <div className="mt-2 space-y-2">
                  {events.filter(e => e.date < today).sort((a,b) => b.date > a.date ? 1 : -1).map(ev => {
                    const d = new Date(ev.date + 'T12:00:00');
                    return (
                      <div key={ev.id} className="group flex items-center gap-3 p-3 rounded-2xl bg-white/35 border border-gray-100 opacity-50 hover:opacity-70 transition-all">
                        <div className="w-10 h-10 rounded-xl flex flex-col items-center justify-center shrink-0 bg-gray-100 text-gray-400">
                          <span className="text-sm font-black leading-none">{d.getDate()}</span>
                          <span className="text-[8px] font-black uppercase">{MONTHS_FR[d.getMonth()]}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-gray-500 truncate line-through">{ev.title}</div>
                          {ev.time && <span className="text-[10px] text-gray-400">{ev.time}</span>}
                        </div>
                        <button onClick={()=>delItem('family_events',ev.id)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 text-red-300 hover:text-red-500 rounded-xl transition-all">
                          <Trash2 size={12}/>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ ONGLET TÂCHES ══ */}
      {calTab === 'tasks' && (
        <div className="space-y-4">
          <button onClick={()=>setShowTaskForm(v=>!v)}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[100px] font-black text-sm text-white shadow-lg hover:scale-[1.01] transition-transform"
            style={{backgroundColor:config.primaryColor}}>
            <Plus size={18}/> Nouvelle tâche
          </button>

          {showTaskForm && (
            <div className="glass-panel p-6 space-y-4 animate-in slide-in-from-top-2">
              <input autoFocus value={newTask.title} onChange={e=>setNewTask(v=>({...v,title:e.target.value}))}
                placeholder="Description de la tâche…"
                className="w-full p-3 rounded-xl border border-white/50 bg-white/40 backdrop-blur-sm focus:bg-white/60 focus:border-white/70 font-bold outline-none text-lg transition-all"/>
              <div className="flex gap-3">
                <input type="date" value={newTask.date} onChange={e=>setNewTask(v=>({...v,date:e.target.value}))}
                  className="flex-1 p-3 rounded-xl border-2 border-gray-100 focus:border-gray-300 font-bold outline-none cursor-pointer"/>
                <button onClick={()=>setNewTask(v=>({...v,hasTime:!v.hasTime}))}
                  className={`px-4 rounded-xl font-bold text-sm border-2 transition-all ${newTask.hasTime?'bg-gray-900 text-white border-gray-900':'bg-white border-gray-200 text-gray-500'}`}>
                  {newTask.hasTime ? 'Heure' : 'Toute la journée'}
                </button>
              </div>
              {newTask.hasTime && (
                <input type="time" value={newTask.time} onChange={e=>setNewTask(v=>({...v,time:e.target.value}))}
                  className="w-full p-3 rounded-xl border-2 border-gray-100 focus:border-gray-300 font-bold outline-none"/>
              )}
              {/* Participants */}
              {(siteUsers||[]).length > 0 && (
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Participants</p>
                  <div className="flex flex-wrap gap-2">
                    {(siteUsers||[]).map((u:any) => {
                      const sel = selectedParticipants.includes(u.id);
                      return (
                        <button key={u.id}
                          onClick={()=>setSelectedParticipants(prev =>
                            sel ? prev.filter(e=>e!==u.id) : [...prev, u.id]
                          )}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all ${
                            sel ? 'text-white' : 'border-gray-200 text-gray-400 bg-white'
                          }`}
                          style={sel ? {backgroundColor:config.primaryColor, borderColor:config.primaryColor} : {}}
                        >
                          <span className="w-5 h-5 rounded-full bg-white/30 flex items-center justify-center font-black text-[10px]">
                            {(u.letter||u.name||u.id||'?')[0].toUpperCase()}
                          </span>
                          {u.name||u.id}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={handleAddTask} disabled={submitting}
                  className="flex-1 py-3 rounded-2xl font-black text-white text-sm disabled:opacity-50"
                  style={{backgroundColor:config.primaryColor}}>
                  {submitting ? 'Ajout…' : '✓ Ajouter'}
                </button>
                <button onClick={()=>setShowTaskForm(false)} className="px-4 py-3 rounded-2xl bg-gray-100 text-gray-500 font-bold text-sm">Annuler</button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {tasks.length === 0 && <p className="text-center text-gray-400 py-10 italic">Aucune tâche…</p>}
            {/* Tâches à faire */}
            {tasks.filter(t => !t.done).map(t => {
              const d = new Date(t.date + 'T12:00:00');
              const isLate = t.date < today;
              return (
                <div key={t.id} className={`group flex items-center gap-3 p-4 rounded-2xl border transition-all hover:shadow-sm ${isLate?'border-red-100 bg-red-50':'bg-white border-gray-100'}`}>
                  <button onClick={()=>toggleTask(t)} className="shrink-0 text-gray-300 hover:text-green-500 transition-colors"><Circle size={22}/></button>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-800 truncate">{t.title}</div>
                    <div className={`text-xs mt-0.5 flex items-center gap-1 ${isLate?'text-red-400':'text-gray-400'}`}>
                      <Clock size={10}/>{d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}
                      {isLate && <span className="font-bold">· En retard</span>}
                    </div>
                  </div>
                  <button onClick={()=>delItem('family_tasks',t.id)}
                    className="opacity-0 group-hover:opacity-100 p-2 text-red-300 hover:text-red-500 rounded-xl transition-all">
                    <Trash2 size={14}/>
                  </button>
                </div>
              );
            })}
            {/* Tâches faites */}
            {tasks.filter(t => t.done).length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-black uppercase tracking-widest text-gray-300 pl-1">Terminées</p>
                {tasks.filter(t => t.done).map(t => (
                  <div key={t.id} className="group flex items-center gap-3 p-3 rounded-2xl bg-white/35 border border-gray-100 opacity-60">
                    <button onClick={()=>toggleTask(t)} className="shrink-0 text-green-400"><CheckCheck size={20}/></button>
                    <div className="flex-1 text-gray-400 line-through text-sm font-bold truncate">{t.title}</div>
                    <button onClick={()=>delItem('family_tasks',t.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-red-300 hover:text-red-500 rounded-xl transition-all">
                      <Trash2 size={12}/>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ ONGLET TABLEAU — grille calendrier mensuelle ══ */}
      {calTab === 'table' && (
        <CalendarTableGrid allItems={allItems} today={today} config={config} delItem={delItem}/>
      )}
    </div>
  );
};

const EventModal = ({ isOpen, onClose, config, addEntry, newEvent, setNewEvent }: any) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  if(!isOpen)return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl space-y-6 relative animate-in zoom-in-95 duration-300">
        <button onClick={()=>onClose(false)} className="absolute top-6 right-6 text-gray-400 hover:text-black"><X size={24}/></button>
        <div className="text-center space-y-2"><div className="mx-auto w-16 h-16 bg-white/35 rounded-full flex items-center justify-center mb-4"><CalIcon size={32} style={{color:config.primaryColor}}/></div><h3 className="text-2xl font-bold tracking-tight">Nouvel Événement</h3></div>
        <div className="space-y-4">
          <div><label className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">Quoi ?</label><input value={newEvent.title} onChange={e=>setNewEvent({...newEvent,title:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-white/35 text-lg font-bold outline-none focus:ring-2" placeholder="Anniversaire..." autoFocus style={{'--tw-ring-color':config.primaryColor} as any}/></div>
          <div><label className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">Quand ?</label><input type="date" value={newEvent.date} onChange={e=>setNewEvent({...newEvent,date:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-white/35 outline-none cursor-pointer"/></div>
          <div onClick={()=>setNewEvent({...newEvent,isAllDay:!newEvent.isAllDay})} className="flex items-center justify-between p-4 rounded-xl border border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"><div className="flex items-center gap-3"><Clock size={20} className={newEvent.isAllDay?"text-gray-300":"text-black"}/><span className="font-bold text-sm">Toute la journée</span></div>{newEvent.isAllDay?<ToggleRight size={32} className="text-green-500"/>:<ToggleLeft size={32} className="text-gray-300"/>}</div>
          {!newEvent.isAllDay&&<div className="animate-in slide-in-from-top-2"><label className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">À quelle heure ?</label><input type="text" value={newEvent.time} onChange={e=>setNewEvent({...newEvent,time:e.target.value})} placeholder="Ex: 20h00" className="w-full p-4 rounded-xl border border-gray-200 bg-white/35 outline-none font-bold text-lg"/></div>}
        </div>
        <button disabled={isSubmitting} onClick={async()=>{if(newEvent.title&&newEvent.date){setIsSubmitting(true);await addEntry('family_events',{title:newEvent.title,date:newEvent.date,time:newEvent.isAllDay?null:(newEvent.time||'')});setNewEvent({title:'',date:new Date().toISOString().split('T')[0],time:'',isAllDay:true});setIsSubmitting(false);onClose(false);}else{alert("Titre et date requis !");}}} className={`w-full py-4 rounded-xl font-black text-white uppercase tracking-widest shadow-lg transform active:scale-95 transition-all ${isSubmitting?'opacity-50':''}`} style={{backgroundColor:config.primaryColor}}>{isSubmitting?"Ajout...":"Ajouter au calendrier"}</button>
      </div>
    </div>
  );
};

// ─── Utilitaire : convertit string d'étapes → [{title, content}] ───────────
const parseStepsToList = (stepsRaw: any): Array<{title:string,content:string}> => {
  if(!stepsRaw && stepsRaw !== 0) return [];
  // Déjà un tableau d'objets {title, content}
  if(Array.isArray(stepsRaw)) {
    if(stepsRaw.length === 0) return [];
    if(typeof stepsRaw[0] === 'object' && stepsRaw[0] !== null && !Array.isArray(stepsRaw[0])) {
      return stepsRaw.map((s:any, i:number) => ({
        title: String(s.title || s.name || `Étape ${i+1}`).trim(),
        content: String(s.content || s.description || s.text || s.instruction || '').trim(),
      })).filter(s => s.content || s.title !== `Étape ${stepsRaw.indexOf(stepsRaw[0])+1}`);
    }
    // Tableau de strings
    return (stepsRaw as any[])
      .map(s => String(s).trim())
      .filter(s => s !== '')
      .map((line:string, i:number) => {
        const colonIdx = line.indexOf(':');
        if(colonIdx>0 && colonIdx<50) {
          return { title: line.slice(0,colonIdx).trim(), content: line.slice(colonIdx+1).trim() };
        }
        return { title: `Étape ${i+1}`, content: line.trim() };
      });
  }
  // String → split par ligne ou par numéro
  const str = String(stepsRaw).trim();
  if(!str) return [];
  const lines = str.split(/\n+/).filter((l:string)=>l.trim()!=='');
  if(lines.length === 0) return [{ title: 'Étape 1', content: str }];
  return lines.map((line:string, i:number) => {
    const colonIdx = line.indexOf(':');
    if(colonIdx>0 && colonIdx<50) {
      return { title: line.slice(0,colonIdx).trim(), content: line.slice(colonIdx+1).trim() };
    }
    return { title: `Étape ${i+1}`, content: line.trim() };
  });
};
  
// ─── Composant MiamStepsReader ─────────────────────────────────────────────
const MiamStepsReader = ({recipe, config, onBack, onEdit}: {recipe:any, config:any, onBack:()=>void, onEdit?:()=>void}) => {
  const [currentStep, setCurrentStep] = React.useState(0);
  const [showIngsMobile, setShowIngsMobile] = React.useState(false);
  const [showFullRecipe, setShowFullRecipe] = React.useState(false);
const [frigoItems, setFrigoItems] = React.useState<string[]>([]);
  React.useEffect(()=>{
    const unsub = onSnapshot(collection(db,'frigo_items'), snap => {
      setFrigoItems(snap.docs.map(d => (d.data().name||'').toLowerCase().trim()));
    });
    return ()=>unsub();
  },[]);

  // Vérifie si un ingrédient est dans le frigo (correspondance approximative)
  const isInFrigo = (ing: string): boolean => {
    const ingLower = ing.toLowerCase().replace(/\d+[\s]*(g|kg|ml|l|cl|cs|cc|tsp|tbsp|pcs|x|×|oz|lb)[\s]*/gi,'').trim();
    const ingWords = ingLower.split(/[\s,]+/).filter(w => w.length > 2);
    return frigoItems.some(fi =>
      ingWords.some(word => fi.includes(word) || word.includes(fi.slice(0,4)))
    );
  };

const steps: Array<{title:string,content:string}> = React.useMemo(() => {
  const raw = recipe.stepsList?.length > 0 ? recipe.stepsList : (recipe.steps || recipe.instructions || '');
  return parseStepsToList(raw);
}, [recipe]);
const ings: string[] = React.useMemo(() => {
  if(Array.isArray(recipe.ingredients)) return recipe.ingredients.filter((i:any)=>String(i).trim());
  return (recipe.ingredients||'').split('\n').filter((i:string)=>i.trim());
}, [recipe]);
const ingInFrigoCount = ings.filter((ing:string) => isInFrigo(ing)).length;
  const total = steps.length;
  const isFinished = currentStep >= total;
  const progress = total>0 ? ((currentStep+1)/total)*100 : 0;

  if(total===0) return (
    <div className="text-center py-20 text-gray-400">
      <ChefHat size={48} className="mx-auto mb-4 opacity-30"/>
      <p className="font-bold">Aucune étape de préparation renseignée.</p>
      {onEdit&&<button onClick={onEdit} className="mt-4 px-6 py-3 rounded-2xl text-white font-bold text-sm" style={{backgroundColor:config.primaryColor}}>Modifier la recette</button>}
    </div>
  );

  if(isFinished) return (
    <div className="flex flex-col items-center justify-center py-20 text-center animate-in zoom-in duration-500">
      <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6 shadow-inner">
        <CheckCircle2 className="text-green-500 w-12 h-12"/>
      </div>
      <h2 className="text-3xl font-bold text-gray-800 mb-3">C'est prêt !</h2>
      <p className="text-gray-500 mb-8 max-w-md">Félicitations, vous avez terminé <strong>{recipe.title}</strong> 🎉</p>
      <div className="flex gap-3">
        <button onClick={()=>setCurrentStep(0)} className="px-8 py-3 rounded-2xl font-bold text-white transition-all hover:scale-105" style={{backgroundColor:config.primaryColor}}>Revoir la recette</button>
        <button onClick={onBack} className="px-8 py-3 rounded-2xl font-bold border-2 border-gray-200 text-gray-600 hover:bg-gray-50 transition-all">Retour aux recettes</button>
      </div>
    </div>
  );

  return (
    <div className="animate-in fade-in duration-300">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 mb-6 px-1">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-bold text-gray-400 hover:text-gray-700 transition-colors">
          <ArrowLeft size={16}/> Recettes
        </button>
        <span className="text-gray-200">/</span>
        <span className="text-sm font-bold text-gray-600 truncate">{recipe.title}</span>
        <button
          onClick={()=>setShowFullRecipe(v=>!v)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 transition-all text-xs font-bold text-gray-500"
          title={showFullRecipe ? 'Mode pas à pas' : 'Voir toute la recette'}
        >
          {showFullRecipe ? <><RotateCcw size={12}/>Pas à pas</> : <><List size={12}/>Tout voir</>}
        </button>
        {onEdit&&<button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-500 transition-colors"><Pencil size={14}/></button>}
      </div>
{/* VUE COMPLÈTE (toggle) */}
      {showFullRecipe && (
        <div className="glass-element p-6 space-y-6 animate-in fade-in">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between mb-3">
              <h3 className="font-black text-sm uppercase tracking-widest text-gray-400">Ingrédients</h3>
              <span className={`text-xs font-black px-2.5 py-1 rounded-full ${ingInFrigoCount===ings.length?'bg-green-100 text-green-700':'bg-gray-100 text-gray-500'}`}>
                🧊 {ingInFrigoCount}/{ings.length}
              </span>
            </div>
            <ul className="space-y-2">
              {ings.map((ing:string,i:number)=>{
                const inFrigo = isInFrigo(ing);
                return (
                  <li key={i} className={`flex items-start gap-2.5 text-sm transition-all ${inFrigo?'text-green-700':'text-gray-600'}`}>
                    {inFrigo
                      ? <CheckCircle2 size={15} className="text-green-500 shrink-0 mt-0.5"/>
                      : <div className="w-1.5 h-1.5 mt-2 rounded-full bg-orange-300 shrink-0"/>
                    }
                    <span className={inFrigo?'line-through opacity-60':''}>{ing}</span>
                  </li>
                );
              })}
            </ul>
            </div>
            <div>
              <h3 className="font-black text-sm uppercase tracking-widest text-gray-400 mb-3">Préparation</h3>
              <ol className="space-y-3">
                {steps.map((step, i)=>(
                  <li key={i} className="flex gap-3">
                    <span className="w-6 h-6 rounded-full text-white text-xs font-black flex items-center justify-center shrink-0 mt-0.5" style={{backgroundColor:'var(--primary,#a85c48)'}}>{i+1}</span>
                    <div>
                      {step.title && step.title !== `Étape ${i+1}` && <p className="font-bold text-sm text-gray-800 mb-0.5">{step.title}</p>}
                      <p className="text-sm text-gray-600 leading-relaxed">{step.content}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}

      {!showFullRecipe && <div className="flex flex-col lg:flex-row gap-6">
        {/* Colonne gauche : infos + ingrédients */}
        <div className="lg:w-1/3 space-y-4">
          <div className="glass-element p-5">
            {recipe.image&&<img src={recipe.image} alt={recipe.title} className="w-full h-40 object-cover rounded-xl mb-4"/>}
            <h2 className="text-2xl font-black text-gray-800 leading-tight mb-3">{recipe.title}</h2>
            {recipe.description&&<p className="text-gray-400 text-sm mb-3">{recipe.description}</p>}
            <div className="flex flex-wrap gap-2">
              {recipe.chef&&<span className="flex items-center gap-1 text-xs font-bold bg-orange-50 text-orange-600 px-3 py-1.5 rounded-full border border-orange-100"><ChefHat size={12}/>{recipe.chef}</span>}
              {recipe.prepTime&&<span className="flex items-center gap-1 text-xs font-bold bg-white/35 text-gray-600 px-3 py-1.5 rounded-full border border-gray-200"><Clock size={12}/>Prép: {recipe.prepTime}</span>}
              {recipe.cookTime&&<span className="flex items-center gap-1 text-xs font-bold bg-white/35 text-gray-600 px-3 py-1.5 rounded-full border border-gray-200"><Utensils size={12}/>Cuis: {recipe.cookTime}</span>}
              {recipe.servings&&<span className="flex items-center gap-1 text-xs font-bold bg-white/35 text-gray-600 px-3 py-1.5 rounded-full border border-gray-200"><Users size={12}/>{recipe.servings} pers.</span>}
            </div>
          </div>
          {/* Toggle ingrédients mobile */}
          <button className="lg:hidden w-full bg-orange-50 text-orange-700 font-bold py-3 px-4 rounded-xl flex justify-between items-center border border-orange-100"
            onClick={()=>setShowIngsMobile(v=>!v)}>
            <span className="flex items-center gap-2"><List size={18}/> Ingrédients ({ings.length})</span>
            <ChevronRight className={`transition-transform ${showIngsMobile?'rotate-90':''}`} size={18}/>
          </button>
          <div className={`bg-white p-5 rounded-2xl shadow-sm border border-gray-100 ${showIngsMobile?'block':'hidden lg:block'}`}>
            <h3 className="font-black text-sm uppercase tracking-widest text-gray-400 mb-3">Ingrédients</h3>
            <ul className="space-y-2">
              {ings.map((ing:string,i:number)=>(
                <li key={i} className="flex items-start gap-2.5 text-sm text-gray-600">
                  <div className="w-1.5 h-1.5 mt-2 rounded-full bg-orange-300 shrink-0"/>
                  {ing}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Colonne droite : étapes */}
        <div className="lg:w-2/3 flex flex-col">
          {/* Barre de progression */}
          <div className="glass-element p-4 rounded-t-2xl flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-gray-400">Étape {currentStep+1} sur {total}</span>
            <span className="text-xs font-black text-orange-500">{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-gray-100 h-1.5">
            <div className="h-full transition-all duration-500" style={{width:`${progress}%`,backgroundColor:config.primaryColor}}/>
          </div>
          {/* Contenu étape */}
          <div className="glass-element p-6 sm:p-10 rounded-b-2xl flex-grow relative overflow-hidden">
            <div className="absolute -top-4 -right-4 text-[130px] font-black text-gray-50 select-none pointer-events-none leading-none">{currentStep+1}</div>
            <div className="relative z-10">
              <h3 className="text-2xl sm:text-3xl font-black mb-5" style={{color:config.primaryColor}}>
                {steps[currentStep]?.title||`Étape ${currentStep+1}`}
              </h3>
              <p className="text-lg sm:text-xl text-gray-700 leading-relaxed min-h-[100px] whitespace-pre-wrap">
                {steps[currentStep]?.content||steps[currentStep] as any}
              </p>
              {/* Navigation */}
              <div className="flex items-center justify-between mt-10 pt-6 border-t border-gray-100 gap-4">
                <button onClick={()=>{setCurrentStep(s=>Math.max(0,s-1));window.scrollTo({top:0,behavior:'smooth'});}}
                  disabled={currentStep===0}
                  className={`flex-1 sm:flex-none flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-bold transition-all ${currentStep===0?'bg-gray-100 text-gray-300 cursor-not-allowed':'bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-95'}`}>
                  <ArrowLeft size={18}/> <span className="hidden sm:inline">Précédent</span>
                </button>
                <button onClick={()=>{setCurrentStep(s=>s+1);window.scrollTo({top:0,behavior:'smooth'});}}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 py-3 px-8 rounded-xl font-bold text-white transition-all active:scale-95 shadow-md hover:shadow-lg hover:scale-105"
                  style={{backgroundColor:currentStep===total-1?'#22c55e':config.primaryColor}}>
                  {currentStep===total-1 ? <>Terminer <CheckCircle2 size={18}/></> : <>Suivant <ChevronRight size={18}/></>}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>}
    </div>
  );
};


const RecipeModal = ({ isOpen, onClose, config, currentRecipe, setCurrentRecipe, updateEntry, addEntry }: any) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [recipeUrl, setRecipeUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isScanningRecipe, setIsScanningRecipe] = useState(false);
  const [scanRecipeMsg, setScanRecipeMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const recipePhotoRef = useRef<HTMLInputElement>(null);

  const handleFile=(e:any,callback:any)=>{
    const f=e.target.files[0];if(!f)return;setIsCompressing(true);const reader=new FileReader();
    reader.onload=(event:any)=>{const img=new Image();img.onload=()=>{const canvas=document.createElement('canvas');const MAX_WIDTH=800;const scale=MAX_WIDTH/img.width;if(scale<1){canvas.width=MAX_WIDTH;canvas.height=img.height*scale;}else{canvas.width=img.width;canvas.height=img.height;}const ctx=canvas.getContext('2d');if(ctx){ctx.drawImage(img,0,0,canvas.width,canvas.height);const compressedDataUrl=canvas.toDataURL('image/jpeg',0.7);callback(compressedDataUrl);setIsCompressing(false);}};img.src=event.target.result;};reader.readAsDataURL(f);
  };

  const importFromUrl = async () => {
    if(!recipeUrl.trim()) return;
    setIsImporting(true);
    try {
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
const handleRecipePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if(!file) return; e.target.value='';
    setIsScanningRecipe(true); setScanRecipeMsg('⏳ Analyse de la photo…');
    try {
      const result = await scanRecipeFromImage(file);
      if(result && result.title) {
        setCurrentRecipe((prev:any) => ({
          ...prev,
          title: result.title || prev.title,
          chef: result.chef || prev.chef,
          category: result.category || prev.category,
          description: result.description || prev.description,
          prepTime: result.prepTime || prev.prepTime,
          cookTime: result.cookTime || prev.cookTime,
          servings: result.servings || prev.servings,
          ingredients: result.ingredients || prev.ingredients,
          steps: result.steps || prev.steps,
        }));
        setScanRecipeMsg('✅ Recette extraite ! Vérifiez et complétez.');
        setTimeout(()=>setScanRecipeMsg(''),4000);
      } else {
        setScanRecipeMsg('❌ Aucune recette détectée. Essayez avec une image plus nette.');
        setTimeout(()=>setScanRecipeMsg(''),4000);
      }
    } catch {
      setScanRecipeMsg('❌ Erreur lors de l\'analyse.');
      setTimeout(()=>setScanRecipeMsg(''),3000);
    }
    setIsScanningRecipe(false);
  };

  if(!isOpen)return null;
  return (
    <div className="fixed inset-0 z-[500] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div
        className="modal-glass w-full md:max-w-2xl rounded-t-[2.5rem] md:rounded-[2.5rem] relative animate-in slide-in-from-bottom md:zoom-in-95 duration-300 overflow-y-auto"
        style={{maxHeight:'calc(100vh - 1rem)', paddingBottom:'calc(1.5rem + env(safe-area-inset-bottom, 0px))'}}
      >
        <div className="sticky top-0 glass-element z-10 px-8 pt-5 pb-3 border-b border-white/30 flex items-center justify-between rounded-t-[2.5rem]">
          <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto md:hidden absolute top-3 left-1/2 -translate-x-1/2"/>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/35 rounded-full flex items-center justify-center hidden md:flex"><ChefHat size={22} style={{color:config.primaryColor}}/></div>
            <h3 className="text-xl font-bold tracking-tight">{currentRecipe.id?'Modifier la Recette':'Nouvelle Recette'}</h3>
          </div>
          <button onClick={()=>onClose(false)} className="text-gray-400 hover:text-black p-2 rounded-full hover:bg-gray-100"><X size={22}/></button>
        </div>

        <div className="px-6 md:px-8 pt-5 space-y-4">
          {/* IMPORT URL */}
          <div className="bg-white/35 p-4 rounded-2xl border border-gray-200">
            <h4 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2"><Link size={12}/> Import depuis URL</h4>
            <div className="flex gap-2">
              <input value={recipeUrl} onChange={e=>setRecipeUrl(e.target.value)} placeholder="https://www.marmiton.org/recettes/..." className="flex-1 min-w-0 p-3 rounded-xl border border-gray-200 bg-white text-sm font-bold outline-none"/>
              <button onClick={importFromUrl} disabled={isImporting||!recipeUrl} className="px-4 py-3 bg-purple-500 text-white rounded-xl hover:scale-105 transition-transform flex items-center gap-2 disabled:opacity-50 shrink-0">
                {isImporting?<Loader2 size={16} className="animate-spin"/>:<Brain size={16}/>}
                <span className="text-xs font-bold hidden sm:block">{isImporting?'Import...':'Importer'}</span>
              </button>
            </div>
          </div>

{/* SCAN PHOTO RECETTE */}
          <div className="bg-purple-50/80 p-4 rounded-2xl border border-purple-100 space-y-2">
            <h4 className="text-xs font-black uppercase tracking-widest text-purple-500 mb-2 flex items-center gap-2">
              <Camera size={12}/> Scanner une recette par photo
            </h4>
            <p className="text-xs text-gray-400">Photographiez une page de livre, une fiche recette ou un écran.</p>
            <input ref={recipePhotoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleRecipePhoto}/>
            <button
              onClick={()=>recipePhotoRef.current?.click()}
              disabled={isScanningRecipe}
              className="w-full flex items-center justify-center gap-2 py-3 bg-purple-500 text-white rounded-xl font-bold text-sm hover:scale-105 transition-transform disabled:opacity-50"
            >
              {isScanningRecipe ? <Loader2 size={16} className="animate-spin"/> : <Camera size={16}/>}
              {isScanningRecipe ? 'Analyse en cours…' : '📷 Scanner une photo de recette'}
            </button>
            {scanRecipeMsg && (
              <div className={`text-center text-xs font-bold py-2 px-3 rounded-xl ${
                scanRecipeMsg.startsWith('✅') ? 'bg-green-50 text-green-700' :
                scanRecipeMsg.startsWith('⏳') ? 'bg-blue-50 text-blue-700' :
                'bg-red-50 text-red-700'
              }`}>{scanRecipeMsg}</div>
            )}
          </div>

          {/* Titre + Description */}
          <input value={currentRecipe.title} onChange={e=>setCurrentRecipe({...currentRecipe,title:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-white/35 text-lg font-bold outline-none" placeholder="Nom du plat..." autoFocus/>
          <textarea value={currentRecipe.description||''} onChange={e=>setCurrentRecipe({...currentRecipe,description:e.target.value})} className="w-full p-3 rounded-xl border border-gray-200 bg-white/35 outline-none text-sm resize-none h-16" placeholder="Courte description (optionnel)..."/>
          {/* Chef + Catégorie */}
          <div className="flex gap-3">
            <input value={currentRecipe.chef} onChange={e=>setCurrentRecipe({...currentRecipe,chef:e.target.value})} className="flex-1 p-3 rounded-xl border border-gray-200 bg-white/35 outline-none text-sm" placeholder="👨‍🍳 Chef (ex: Papa)"/>
            <select value={currentRecipe.category} onChange={e=>setCurrentRecipe({...currentRecipe,category:e.target.value})} className="flex-1 p-3 rounded-xl border border-gray-200 bg-white/35 outline-none text-sm">
              <option value="entrée">🥗 Entrée</option><option value="plat">🍽️ Plat</option><option value="dessert">🍰 Dessert</option><option value="autre">🍴 Autre</option>
            </select>
          </div>
          {/* Temps + Portions */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Préparation</label>
              <input value={currentRecipe.prepTime||''} onChange={e=>setCurrentRecipe({...currentRecipe,prepTime:e.target.value})} className="w-full p-3 rounded-xl border border-gray-200 bg-white/35 outline-none text-sm" placeholder="15 min"/>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Cuisson</label>
              <input value={currentRecipe.cookTime||''} onChange={e=>setCurrentRecipe({...currentRecipe,cookTime:e.target.value})} className="w-full p-3 rounded-xl border border-gray-200 bg-white/35 outline-none text-sm" placeholder="30 min"/>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Portions</label>
              <input type="number" min="1" value={currentRecipe.servings||4} onChange={e=>setCurrentRecipe({...currentRecipe,servings:parseInt(e.target.value)||4})} className="w-full p-3 rounded-xl border border-gray-200 bg-white/35 outline-none text-sm"/>
            </div>
          </div>
          {/* Photo */}
          <div onClick={()=>!isCompressing&&fileRef.current?.click()} className="p-5 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 flex items-center justify-center gap-3 text-gray-400">
            {isCompressing?<><Loader2 className="animate-spin" size={18}/><span className="text-sm font-bold text-blue-500">Compression...</span></>
            :currentRecipe.image?<><CheckCircle2 size={18} className="text-green-500"/><span className="text-sm font-bold text-green-600">Photo ajoutée !</span></>
            :<><Upload size={18}/><span className="text-sm">📷 Ajouter une photo</span></>}
          </div>
          <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e=>handleFile(e,(b:string)=>setCurrentRecipe({...currentRecipe,image:b}))}/>
          {/* Ingrédients + Étapes */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Ingrédients (un par ligne)</label>
              <textarea value={currentRecipe.ingredients} onChange={e=>setCurrentRecipe({...currentRecipe,ingredients:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-white/35 outline-none h-44 text-sm resize-none" placeholder="200g farine&#10;3 œufs&#10;100ml lait..."/>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Étapes de préparation</label>
              <textarea value={currentRecipe.steps} onChange={e=>setCurrentRecipe({...currentRecipe,steps:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-white/35 outline-none h-44 text-sm resize-none" placeholder="Étape 1 : Préchauffer le four...&#10;Étape 2 : Mélanger les ingrédients..."/>
            </div>
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
  <div className={`md:hidden fixed bottom-0 w-full h-24 flex justify-around items-center rounded-t-[2.5rem] z-40 px-4 pb-4 transition-transform duration-300 bottom-nav-glass ${hidden ? 'translate-y-full' : 'translate-y-0'}`} style={{color:config.primaryColor}}>
    {[
      {id:'home',i:<Home size={22}/>},
      {id:'hub',i:<LayoutDashboard size={22}/>},
      {id:'tasks',i:<CheckSquare size={22}/>},
      {id:'recipes',i:<ChefHat size={22}/>},
      {id:'cooking',i:<CalIcon size={22}/>}
    ].map(b=><button key={b.id} onClick={()=>setView(b.id)} className={`p-2 ${view===b.id?'opacity-100 -translate-y-2 bg-white/20 rounded-xl':''}`}>{b.i}</button>)}
  </div>
);

const HomeCard = ({ icon, title, label, onClick, color }: any) => (
  <div onClick={onClick} className="card-glass p-6 md:p-10 rounded-[2rem] md:rounded-[3rem] cursor-pointer hover:scale-105 transition-transform shadow-lg border border-white/50 group">
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
      <div className="bg-white/35 p-6 rounded-3xl border border-gray-100 space-y-4">
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

// ==========================================
// QUESTIONNAIRE SYSTEM
// ==========================================
type QQuestion = {
  id: string;
  text: string;
  type: 'qcm' | 'libre';
  options: string[];       // pour QCM
  multipleAnswers: boolean; // QCM : une ou plusieurs réponses
  imageUrl?: string;        // <-- NOUVEAU : URL optionnelle de l'image
};

type QForm = {
  id: string;
  title: string;
  questions: QQuestion[];
  createdAt: string;
  createdBy: string;
};

type QResponse = {
  id: string;
  formId: string;
  respondent: string;
  answers: Record<string, string | string[]>;
  submittedAt: string;
};

const QuestionnaireModal = ({isOpen, onClose, config, siteUsers, userEmail}: {
  isOpen: boolean;
  onClose: () => void;
  config: any;
  siteUsers: any[];
  userEmail: string;
}) => {
  const [step, setStep] = React.useState<'create'|'results'>('create');
  const [title, setTitle] = React.useState('');
  const [questions, setQuestions] = React.useState<QQuestion[]>([]);
  const [forms, setForms] = React.useState<QForm[]>([]);
  const [responses, setResponses] = React.useState<QResponse[]>([]);
  const [activeFormId, setActiveFormId] = React.useState<string|null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [sentFormId, setSentFormId] = React.useState<string|null>(null);
  const [shareMode, setShareMode] = React.useState<null|'whatsapp'|'email'>(null);
  const [selectedForm, setSelectedForm] = React.useState<QForm|null>(null);

  // Charger les formulaires et réponses depuis Firestore
  React.useEffect(() => {
    if(!isOpen) return;
    const unsubF = onSnapshot(collection(db,'questionnaires'), snap => {
      setForms(snap.docs.map(d => ({id:d.id,...d.data()} as QForm)));
    });
    const unsubR = onSnapshot(collection(db,'questionnaire_responses'), snap => {
      setResponses(snap.docs.map(d => ({id:d.id,...d.data()} as QResponse)));
    });
    return () => { unsubF(); unsubR(); };
  }, [isOpen]);

  const addQuestion = () => {
    setQuestions(prev => [...prev, {
      id: Date.now().toString(),
      text: '',
      type: 'qcm',
      options: ['', ''],
      multipleAnswers: false,
    }]);
  };

  const removeQuestion = (qid: string) => setQuestions(prev => prev.filter(q => q.id !== qid));

  const updateQuestion = (qid: string, patch: Partial<QQuestion>) => {
    setQuestions(prev => prev.map(q => q.id === qid ? {...q,...patch} : q));
  };

  const addOption = (qid: string) => {
    setQuestions(prev => prev.map(q => q.id === qid ? {...q, options:[...q.options,'']} : q));
  };

  const removeOption = (qid: string, oidx: number) => {
    setQuestions(prev => prev.map(q => q.id === qid
      ? {...q, options: q.options.filter((_,i) => i!==oidx)}
      : q
    ));
  };

  const updateOption = (qid: string, oidx: number, val: string) => {
    setQuestions(prev => prev.map(q => q.id === qid
      ? {...q, options: q.options.map((o,i) => i===oidx ? val : o)}
      : q
    ));
  };

  const saveForm = async () => {
    if(!title.trim() || questions.length === 0) return;
    setIsSaving(true);
    const ref = await addDoc(collection(db,'questionnaires'), {
      title,
      questions,
      createdAt: new Date().toISOString(),
      createdBy: userEmail,
    });
    setSentFormId(ref.id);
    setTitle('');
    setQuestions([]);
    setIsSaving(false);
  };

  const deleteForm = async (fid: string) => {
    if(!confirm('Supprimer ce questionnaire ?')) return;
    await deleteDoc(doc(db,'questionnaires',fid));
    // Supprimer les réponses associées
    const related = responses.filter(r => r.formId === fid);
    await Promise.all(related.map(r => deleteDoc(doc(db,'questionnaire_responses',r.id))));
  };

  const getFormLink = (fid: string) => {
    // Le lien dirige vers l'accueil du site avec un paramètre quiz
    // L'app détecte ce paramètre au chargement et affiche le quiz post-login
    return window.location.origin + window.location.pathname + '?quiz=' + fid;
  };

  // Résultats d'un formulaire
  const getFormResponses = (fid: string) => responses.filter(r => r.formId === fid);

  const getOptionCount = (fid: string, qid: string, option: string) => {
    return getFormResponses(fid).filter(r => {
      const ans = r.answers[qid];
      return Array.isArray(ans) ? ans.includes(option) : ans === option;
    }).length;
  };

  const emails = siteUsers.map((u: any) => u.id).filter(Boolean).join(',');

  if(!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[500] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={onClose}>
      <div
        className="modal-glass w-full md:max-w-3xl rounded-t-[2.5rem] md:rounded-[2.5rem] overflow-y-auto"
        style={{maxHeight:'92vh', paddingBottom:'calc(1.5rem + env(safe-area-inset-bottom,0px))'}}
        onClick={e=>e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 px-6 pt-5 pb-4 border-b border-white/20 flex items-center justify-between" style={{background:'rgba(242,237,228,0.90)', backdropFilter:'blur(20px)'}}>
          <div className="flex items-center gap-3">
            <div className="flex gap-2">
              <button onClick={()=>setStep('create')} className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${step==='create'?'bg-black text-white':'bg-white/30 text-gray-600'}`}>
                Créer
              </button>
              <button onClick={()=>setStep('results')} className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${step==='results'?'bg-black text-white':'bg-white/30 text-gray-600'}`}>
                Résultats
              </button>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/30"><X size={20}/></button>
        </div>

        <div className="p-6 space-y-6">

          {/* ── CRÉATION ── */}
          {step==='create'&&(<>
            {/* Liste des questionnaires existants */}
            {forms.length>0&&(
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-widest text-gray-400">Mes questionnaires</h4>
                {forms.map(f=>(
                  <div key={f.id} className="glass-element p-4 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate">{f.title}</p>
                      <p className="text-xs text-gray-400">{getFormResponses(f.id).length} réponse(s)</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {/* Lien Envoyer */}
                      {sentFormId===f.id&&shareMode===null?(
                        <div className="flex gap-2 flex-wrap">
                          {/* → Envoyer sur le site (apparaît au login) */}
                          <button
                            onClick={async()=>{
                              // Marquer le quiz comme "à afficher" pour tous les membres
                              // en supprimant leur marque quiz_done/quiz_skipped
                              const usersSnap = await getDocs(collection(db,'site_users'));
                              await Promise.all(usersSnap.docs.map(ud=>
                                setDoc(doc(db,'user_prefs',ud.id),{
                                  [`quiz_done_${f.id}`]: false,
                                  [`quiz_skipped_${f.id}`]: false,
                                },{merge:true})
                              ));
                              alert('✅ Questionnaire envoyé sur le site !\nIl apparaîtra au prochain login de chaque membre.');
                            }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold hover:scale-105 transition-transform"
                            style={{background:'rgba(255,255,255,0.45)',border:'1.5px solid rgba(0,0,0,0.85)',color:'rgba(0,0,0,0.85)'}}
                            title="Afficher au prochain login"
                          >
                            <ChevronRight size={13}/>Site
                          </button>
                          {/* WhatsApp */}
                          <button onClick={()=>setShareMode('whatsapp')} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-green-500 text-white text-xs font-bold hover:scale-105 transition-transform">
                            <Share2 size={12}/>WA
                          </button>
                          {/* Email */}
                          <button onClick={()=>setShareMode('email')} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-blue-500 text-white text-xs font-bold hover:scale-105 transition-transform">
                            <Mail size={12}/>Mail
                          </button>
                        </div>
                      ):(
                        <button
                          onClick={()=>{setSentFormId(f.id);setShareMode(null);}}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-black text-white text-xs font-bold hover:scale-105 transition-transform"
                        >
                          <Send size={12}/>Envoyer
                        </button>
                      )}
                      <button onClick={()=>deleteForm(f.id)} className="p-2 rounded-full hover:bg-red-50 text-red-400"><Trash2 size={14}/></button>
                    </div>
                  </div>
                ))}

                {/* Share modals */}
                {sentFormId&&shareMode&&(()=>{
                  const link = getFormLink(sentFormId);
                  const msg = encodeURIComponent("🍽 Questionnaire Chaud Devant !\n" + link);

                  const f = forms.find(x=>x.id===sentFormId);
                  return (
                    <div className="glass-panel p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-black uppercase tracking-widest text-gray-400">
                          {shareMode==='whatsapp'?'Partager via WhatsApp':'Envoyer par Email'}
                        </p>
                        <button onClick={()=>setShareMode(null)} className="p-1 rounded-full hover:bg-white/30"><X size={14}/></button>
                      </div>
                      {shareMode==='whatsapp'&&(
                        <a href={"https://wa.me/?text="+msg} target="_blank" rel="noreferrer"
                          className="flex items-center justify-center gap-2 w-full py-3 bg-green-500 text-white rounded-full font-bold text-sm hover:scale-105 transition-transform">
                          <Share2 size={16}/>Ouvrir WhatsApp
                        </a>
                      )}
                      {shareMode==='email'&&(
                        <div className="space-y-2">
                          <input
                            defaultValue={emails}
                            className="w-full p-3 rounded-xl bg-white/40 border border-white/50 text-sm font-bold"
                            placeholder="emails destinataires..."
                            id="quiz-email-to"
                          />
                          <button
                            onClick={()=>{
                              const to = (document.getElementById('quiz-email-to') as HTMLInputElement)?.value || emails;
                              const sub = encodeURIComponent("📋 " + (f?.title||'Questionnaire'));
                              const body = encodeURIComponent("Bonjour,\n\nVeuillez répondre au questionnaire :\n" + link);

                              window.location.href = `mailto:${to}?subject=${sub}&body=${body}`;
                            }}
                            className="flex items-center justify-center gap-2 w-full py-3 bg-blue-500 text-white rounded-full font-bold text-sm hover:scale-105 transition-transform"
                          >
                            <Mail size={16}/>Envoyer l'email
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Formulaire de création */}
            <div className="glass-panel p-5 space-y-4">
              <h4 className="text-xs font-black uppercase tracking-widest text-gray-400">Nouveau questionnaire</h4>
              <input
                value={title}
                onChange={e=>setTitle(e.target.value)}
                placeholder="Titre du questionnaire..."
                className="w-full p-3 rounded-xl bg-white/40 border border-white/50 font-bold text-sm outline-none"
              />

              {/* Questions */}
              {questions.map((q, qi)=>(
                <div key={q.id} className="glass-element p-4 space-y-3">
                 <div className="flex items-start gap-2">
  <span className="w-6 h-6 rounded-full bg-black text-white flex items-center justify-center text-xs font-black shrink-0 mt-1">{qi+1}</span>
  <div className="flex-1 space-y-2">
    {/* Texte de la question */}
    <input
      value={q.text}
      onChange={e=>updateQuestion(q.id,{text:e.target.value})}
      placeholder="Texte de la question..."
      className="w-full p-2 rounded-xl bg-white/40 border border-white/40 text-sm font-bold outline-none"
    />

    {/* Zone d'Upload / Sélection de fichier */}
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-2 cursor-pointer bg-white/50 hover:bg-white/80 px-3 py-1.5 rounded-xl border border-dashed border-gray-400 transition-all">
        <Upload size={14} className="text-gray-600" />
        <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">
          {q.imageUrl ? "Changer l'image" : "Sélectionner un fichier"}
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            try {
              // 1. Importer les fonctions Storage (ou assurez-vous qu'elles le sont en haut du fichier)
              const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
              const { storage } = await import('./firebase'); 

              // 2. Créer une référence unique
              const storageRef = ref(storage, `quiz_images/${q.id}_${file.name}`);
              
              // 3. Upload
              const snapshot = await uploadBytes(storageRef, file);
              
              // 4. Récupérer l'URL et mettre à jour
              const downloadURL = await getDownloadURL(snapshot.ref);
              updateQuestion(q.id, { imageUrl: downloadURL });
            } catch (error) {
              console.error("Erreur upload:", error);
              alert("Erreur lors de l'envoi du fichier.");
            }
          }}
        />
      </label>

      {/* Miniature d'aperçu si une image existe */}
      {q.imageUrl && (
        <div className="relative group">
          <img 
            src={q.imageUrl} 
            alt="Aperçu" 
            className="w-10 h-10 object-cover rounded-lg border border-white shadow-sm" 
          />
          <button 
            onClick={() => updateQuestion(q.id, { imageUrl: '' })}
            className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 shadow-lg hover:bg-red-600"
          >
            <X size={10} />
          </button>
        </div>
      )}
    </div>
  </div>
  <button onClick={()=>removeQuestion(q.id)} className="p-1.5 mt-1 rounded-full hover:bg-red-50 text-red-400 shrink-0">
    <Trash2 size={14}/>
  </button>
</div>
                  {/* Toggle type */}
                  <div className="flex gap-2">
                    <button onClick={()=>updateQuestion(q.id,{type:'qcm'})}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${q.type==='qcm'?'bg-black text-white':'bg-white/30 text-gray-600'}`}>
                      QCM
                    </button>
                    <button onClick={()=>updateQuestion(q.id,{type:'libre'})}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${q.type==='libre'?'bg-black text-white':'bg-white/30 text-gray-600'}`}>
                      Réponse libre
                    </button>
                    {q.type==='qcm'&&(
                      <button onClick={()=>updateQuestion(q.id,{multipleAnswers:!q.multipleAnswers})}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${q.multipleAnswers?'bg-blue-500 text-white':'bg-white/30 text-gray-600'}`}>
                        Multi-réponses
                      </button>
                    )}
                  </div>

                  {/* Options QCM */}
                  {q.type==='qcm'&&(
                    <div className="space-y-2">
                      {q.options.map((opt, oi)=>(
                        <div key={oi} className="flex gap-2 items-center">
                          <div className={`w-4 h-4 rounded-${q.multipleAnswers?'sm':'full'} border border-gray-300 shrink-0`}/>
                          <input
                            value={opt}
                            onChange={e=>updateOption(q.id,oi,e.target.value)}
                            placeholder={`Option ${oi+1}...`}
                            className="flex-1 p-2 rounded-xl bg-white/40 border border-white/40 text-sm outline-none"
                          />
                          {q.options.length>2&&(
                            <button onClick={()=>removeOption(q.id,oi)} className="p-1 rounded-full hover:bg-red-50 text-red-300"><X size={12}/></button>
                          )}
                        </div>
                      ))}
                      <button onClick={()=>addOption(q.id)} className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-gray-700">
                        <Plus size={14}/>Ajouter une option
                      </button>
                    </div>
                  )}
                </div>
              ))}

              <div className="flex gap-3">
                <button onClick={addQuestion}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full border-2 border-dashed border-gray-300 text-sm font-bold text-gray-500 hover:border-gray-500 hover:text-gray-800 transition-all">
                  <Plus size={16}/>Ajouter une question
                </button>
                {questions.length>0&&title.trim()&&(
                  <button onClick={saveForm} disabled={isSaving}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full bg-black text-white text-sm font-bold disabled:opacity-50 hover:scale-105 transition-transform">
                    {isSaving?<Loader2 size={16} className="animate-spin"/>:<Send size={16}/>}
                    Publier & Envoyer
                  </button>
                )}
              </div>
            </div>
          </>)}

          {/* ── RÉSULTATS GRAPHIQUES ── */}
          {step==='results'&&(
            <div className="space-y-6">
              {forms.length===0&&<p className="text-center text-gray-400 py-10 italic">Aucun questionnaire créé.</p>}
              {forms.map(f=>{
                const resps = getFormResponses(f.id);
                return (
                  <div key={f.id} className="glass-panel p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-black text-base">{f.title}</h4>
                        <p className="text-xs text-gray-400">{resps.length} réponse(s)</p>
                      </div>
                      <BarChart2 size={20} className="text-gray-300"/>
                    </div>
                    {f.questions.map(q=>{
                      if(q.type==='libre'){
                        const answers = resps.map(r => r.answers[q.id]).filter(Boolean) as string[];
                        return (
                          <div key={q.id} className="glass-element p-3 space-y-2">
                            <p className="text-sm font-bold">{q.text}</p>
                            {answers.length===0?<p className="text-xs text-gray-400 italic">Pas encore de réponses</p>:
                            answers.map((a,i)=>(
                              <div key={i} className="p-2 bg-white/30 rounded-xl text-xs">{a}</div>
                            ))}
                          </div>
                        );
                      }
                      // QCM — graphique barres
                      const total = resps.length || 1;
                      return (
                        <div key={q.id} className="glass-element p-3 space-y-2">
                          <p className="text-sm font-bold">{q.text}</p>
                          {q.options.map(opt=>{
                            const count = getOptionCount(f.id, q.id, opt);
                            const pct = Math.round(count/total*100);
                            return (
                              <div key={opt} className="space-y-1">
                                <div className="flex justify-between text-xs font-bold">
                                  <span>{opt||'—'}</span>
                                  <span className="text-gray-400">{count} · {pct}%</span>
                                </div>
                                <div className="h-2 bg-white/30 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full transition-all duration-700"
                                    style={{width:pct+'%', backgroundColor:config.primaryColor}}/>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

// Composant PublicQuiz — répondre à un questionnaire (affiché si ?view=quiz&id=...)
const PublicQuiz = ({formId, config}: {formId: string, config: any}) => {
  const [form, setForm] = React.useState<QForm|null>(null);
  const [answers, setAnswers] = React.useState<Record<string, string|string[]>>({});
  const [name, setName] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(()=>{
    getDoc(doc(db,'questionnaires',formId)).then(snap=>{
      if(snap.exists()) setForm({id:snap.id,...snap.data()} as QForm);
      setLoading(false);
    });
  },[formId]);

  const toggleAnswer = (qid: string, opt: string, multi: boolean) => {
    setAnswers(prev=>{
      if(multi){
        const cur = (prev[qid] as string[])||[];
        return {...prev, [qid]: cur.includes(opt)?cur.filter(x=>x!==opt):[...cur,opt]};
      }
      return {...prev, [qid]: prev[qid]===opt?'':opt};
    });
  };

  const submit = async () => {
    if(!name.trim()||!form) return;
    await addDoc(collection(db,'questionnaire_responses'),{
      formId, respondent:name, answers, submittedAt:new Date().toISOString()
    });
    setSubmitted(true);
  };

  if(loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" size={32}/></div>;
  if(!form) return <div className="min-h-screen flex items-center justify-center text-gray-400">Questionnaire introuvable.</div>;
  if(submitted) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
      <CheckCircle2 size={64} className="text-green-500"/>
      <h2 className="text-3xl font-black uppercase tracking-tighter">Merci !</h2>
      <p className="text-gray-500">Votre réponse a bien été enregistrée.</p>
    </div>
  );

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-2xl mx-auto space-y-6 pt-20">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Questionnaire</p>
        <h1 className="text-3xl font-black uppercase tracking-tighter mt-1">{form.title}</h1>
      </div>
      <input value={name} onChange={e=>setName(e.target.value)}
        placeholder="Votre prénom..."
        className="w-full p-4 rounded-2xl bg-white/40 border border-white/50 font-bold text-sm outline-none"/>
      {form.questions.map((q,qi)=>(
        <div key={q.id} className="glass-panel p-5 space-y-3">
          <p className="font-bold">{qi+1}. {q.text}</p>
          
          {/* NOUVEAU : Bouton natif pour révéler l'image */}
          {q.imageUrl && (
            <details className="group">
              <summary className="cursor-pointer text-xs font-bold text-blue-500 hover:text-blue-700 flex items-center gap-1.5 mb-3 select-none list-none">
                <ImageIcon size={14}/> Voir l'image
              </summary>
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <img src={q.imageUrl} alt="Illustration de la question" className="max-w-full h-auto rounded-xl shadow-sm border border-white/50 mb-3"/>
              </div>
            </details>
          )}

          {q.type==='libre'?(
            <textarea value={(answers[q.id] as string)||''} onChange={e=>setAnswers(p=>({...p,[q.id]:e.target.value}))}
              placeholder="Votre réponse..."
              className="w-full p-3 rounded-xl bg-white/40 border border-white/50 text-sm outline-none resize-none h-24"/>
          ):(
            <div className="space-y-2">
              {q.options.map(opt=>{
                const cur = answers[q.id];
                const sel = Array.isArray(cur)?cur.includes(opt):cur===opt;
                return (
                  <button key={opt} onClick={()=>toggleAnswer(q.id,opt,q.multipleAnswers)}
                    className={`w-full text-left p-3 rounded-xl text-sm font-bold transition-all border ${sel?'border-current text-white':'border-white/40 bg-white/30 text-gray-700'}`}
                    style={sel?{backgroundColor:config.primaryColor,borderColor:config.primaryColor}:{}}>
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-${q.multipleAnswers?'sm':'full'} border-2 flex items-center justify-center flex-shrink-0 ${sel?'bg-white border-white':'border-current opacity-50'}`}>
                        {sel&&<div className={`w-2 h-2 rounded-${q.multipleAnswers?'sm':'full'} bg-current`} style={{color:config.primaryColor}}/>}
                      </div>
                      {opt}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
      <button onClick={submit} disabled={!name.trim()}
        className="w-full py-4 rounded-full bg-black text-white font-black uppercase tracking-widest disabled:opacity-40 hover:scale-105 transition-transform flex items-center justify-center gap-2">
        <Send size={18}/>Envoyer mes réponses
      </button>
    </div>
  );
};

// InlineQuiz — version modale du PublicQuiz (sans layout full-page)
const InlineQuiz = ({formId, config, userEmail, onDone}: {
  formId: string;
  config: any;
  userEmail: string;
  onDone: () => void;
}) => {
  const [form, setForm] = React.useState<QForm|null>(null);
  const [answers, setAnswers] = React.useState<Record<string, string|string[]>>({});
  const [submitted, setSubmitted] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(()=>{
    getDoc(doc(db,'questionnaires',formId)).then(snap=>{
      if(snap.exists()) setForm({id:snap.id,...snap.data()} as QForm);
      setLoading(false);
    });
  },[formId]);

  const toggleAnswer = (qid: string, opt: string, multi: boolean) => {
    setAnswers(prev=>{
      if(multi){
        const cur = (prev[qid] as string[])||[];
        return {...prev, [qid]: cur.includes(opt)?cur.filter(x=>x!==opt):[...cur,opt]};
      }
      return {...prev, [qid]: prev[qid]===opt?'':opt};
    });
  };

  const submit = async () => {
    if(!form) return;
    await addDoc(collection(db,'questionnaire_responses'),{
      formId,
      respondent: userEmail,
      answers,
      submittedAt: new Date().toISOString()
    });
    setSubmitted(true);
    setTimeout(onDone, 1800);
  };

  if(loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="animate-spin" size={28}/>
    </div>
  );

  if(!form) return (
    <div className="py-10 text-center text-gray-400 text-sm">Questionnaire introuvable.</div>
  );

  if(submitted) return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <CheckCircle2 size={52} className="text-green-500"/>
      <h2 className="text-2xl font-black uppercase tracking-tighter">Merci !</h2>
      <p className="text-gray-500 text-sm">Réponse enregistrée — redirection…</p>
    </div>
  );

  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="text-2xl font-black uppercase tracking-tighter">{form.title}</h2>
        <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest">{form.questions.length} question(s)</p>
      </div>

      {form.questions.map((q,qi)=>(
        <div key={q.id} className="glass-element p-4 space-y-3">
          <p className="font-bold text-sm">{qi+1}. {q.text}</p>

          {/* NOUVEAU : Bouton natif pour révéler l'image */}
          {q.imageUrl && (
            <details className="group">
              <summary className="cursor-pointer text-xs font-bold text-blue-500 hover:text-blue-700 flex items-center gap-1.5 mb-3 select-none list-none">
                <ImageIcon size={14}/> Voir l'image
              </summary>
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <img src={q.imageUrl} alt="Illustration de la question" className="max-w-full h-auto rounded-xl shadow-sm border border-white/50 mb-3"/>
              </div>
            </details>
          )}

          {q.type==='libre' ? (
            <textarea
              value={(answers[q.id] as string)||''}
              onChange={e=>setAnswers(p=>({...p,[q.id]:e.target.value}))}
              placeholder="Votre réponse..."
              className="w-full p-3 rounded-xl bg-white/40 border border-white/50 text-sm outline-none resize-none h-20"
            />
          ) : (
            <div className="space-y-2">
              {q.options.map(opt=>{
                const cur = answers[q.id];
                const sel = Array.isArray(cur) ? cur.includes(opt) : cur===opt;
                return (
                  <button key={opt}
                    onClick={()=>toggleAnswer(q.id,opt,q.multipleAnswers)}
                    className={`w-full text-left p-3 rounded-xl text-sm font-bold transition-all border ${
                      sel ? 'text-white border-current' : 'border-white/40 bg-white/30 text-gray-700'
                    }`}
                    style={sel ? {backgroundColor:config.primaryColor,borderColor:config.primaryColor} : {}}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 flex-shrink-0 border-2 flex items-center justify-center ${
                        q.multipleAnswers ? 'rounded-sm' : 'rounded-full'
                      } ${sel ? 'border-white bg-white/20' : 'border-current opacity-50'}`}>
                        {sel && <div className={`w-2 h-2 bg-white ${q.multipleAnswers?'rounded-sm':'rounded-full'}`}/>}
                      </div>
                      {opt}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}

      <button
        onClick={submit}
        className="w-full py-4 rounded-full bg-black text-white font-black uppercase tracking-widest hover:scale-105 transition-transform flex items-center justify-center gap-2"
      >
        <Send size={16}/>Envoyer mes réponses
      </button>
    </div>
  );
};


const AdminPanel = ({ config, save, add, del, upd, events, recipes, xsitePages, versions, restore, arch, chat, prompt, setP, load, hist, users, choreStatus, lockedPagesMap, onSaveMaintenance, onSetAdminTokenUser }: any) => {
  const [tab, setTab] = useState('users');
  const [showQuizModal, setShowQuizModal] = useState(false);
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
  const generateQrCode=(siteId:string)=>{const baseUrl=window.location.href.split('?')[0];const fullUrl=`${baseUrl}?view=xsite&id=${siteId}`;const apiUrl=`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(fullUrl)}`;setQrCodeUrl(apiUrl);};
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
    {id:'quiz',l:'QUESTIONNAIRES',i:<FileText size={16}/>},
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

          <div className="bg-white/35 p-6 rounded-3xl border border-gray-100">
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

                  {/* Plan — bouton unique toggle + bouton tokens */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Bouton forfait : affiche l'état actuel, clic bascule vers l'autre */}
                    {(() => {
                      const isPro = u.plan === 'pro' || u.plan === 'premium';
                      return (
                        <button
                          onClick={()=>saveUserField(u.id,'plan', isPro ? 'free' : 'pro')}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-xl font-black text-[10px] uppercase transition-all ${
                            isPro ? 'text-white shadow-md' : 'bg-gray-900 text-white'
                          }`}
                          style={isPro ? {backgroundColor: config.primaryColor} : {}}
                          title={isPro ? 'Cliquer pour passer en Gratuit' : 'Cliquer pour passer en Premium'}
                        >
                          <Crown size={10} fill={isPro ? 'white' : 'none'} className={isPro ? 'text-white' : 'text-gray-400'}/>
                          {isPro ? 'Premium' : 'Gratuit'}
                        </button>
                      );
                    })()}
                    {/* Bouton tokens admin */}
                    <button
                      onClick={()=>onSetAdminTokenUser&&onSetAdminTokenUser({id:u.id, name:u.name||u.letter||u.id})}
                      className="w-7 h-7 rounded-full bg-amber-50 border border-amber-200 text-amber-600 hover:bg-amber-100 transition-colors flex items-center justify-center"
                      title={`Gérer les tokens de ${u.name||u.id}`}
                    ><Coins size={13}/></button>
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
          <div className="bg-white/35 p-6 rounded-3xl border border-gray-100 space-y-4">
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
              <div key={v.id} className="flex gap-4 items-center p-4 bg-white/35 rounded-2xl border border-gray-100 group hover:border-gray-300 transition-all">
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
          <GithubConfigPanel db={db} />
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
              <div key={site.id} className="flex justify-between items-center p-4 bg-white/35 rounded-2xl border border-gray-200">
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
            <input value={currentXSite.name} onChange={e=>setCurrentXSite({...currentXSite,name:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-white/35 font-bold outline-none" placeholder="Nom du fichier"/>
            <textarea value={currentXSite.html} onChange={e=>setCurrentXSite({...currentXSite,html:e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-white/35 font-mono text-xs h-48 outline-none" placeholder="HTML..."/>
            {/* Doc sauvegarde Firebase */}
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 space-y-2">
              <p className="text-xs font-black text-blue-700 uppercase tracking-widest">💾 Sauvegarde automatique Firebase</p>
              <p className="text-xs text-blue-600">Dans votre HTML, utilisez <code className="bg-blue-100 px-1 rounded font-mono">localStorage.setItem()</code> et <code className="bg-blue-100 px-1 rounded font-mono">localStorage.getItem()</code> normalement.<br/>L'interface XSite intercepte automatiquement ces appels et les redirige vers Firebase — les données sont propres à chaque utilisateur.</p>
              <details className="text-xs text-blue-500 cursor-pointer">
                <summary className="font-bold hover:text-blue-700">Voir le code d'exemple</summary>
                <pre className="mt-2 bg-white border border-blue-100 rounded-xl p-3 overflow-x-auto text-[10px] text-gray-700">{`<!DOCTYPE html>
<html>
<body>
  <input id="note" placeholder="Votre note..."/>
  <button onclick="save()">Sauvegarder</button>
  <p id="display"></p>
  <script>
    // localStorage est redirigé vers Firebase automatiquement
    document.getElementById('display').textContent =
      localStorage.getItem('ma_note') || '';

    function save() {
      const val = document.getElementById('note').value;
      localStorage.setItem('ma_note', val); // → Firebase
      document.getElementById('display').textContent = val;
    }
  </script>
</body>
</html>`}</pre>
              </details>
            </div>
            <button onClick={()=>{if(currentXSite.id){upd('xsite_pages',currentXSite.id,currentXSite);}else{add('xsite_pages',currentXSite);}setCurrentXSite({id:'',name:'',html:''}); }} className="w-full py-4 text-white font-bold rounded-xl uppercase shadow-lg" style={{backgroundColor:config.primaryColor}}>Sauvegarder</button>
          </div>
        </div>
      )}

      {/* PARAMÈTRES (Regroupement Accueil + Semainier + Maintenance) */}
      {tab==='quiz'&&(
        <div className="space-y-6 animate-in fade-in">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-3xl font-bold tracking-tight" style={{color:config.primaryColor}}>QUESTIONNAIRES</h3>
              <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest">Créer et analyser les réponses de la famille</p>
            </div>
            <div className="flex gap-3">
              <button onClick={()=>setShowQuizModal(true)}
                className="flex items-center gap-2 px-5 py-3 rounded-full bg-black text-white text-xs font-black uppercase tracking-widest hover:scale-105 transition-transform">
                <Plus size={16}/>Créer un questionnaire
              </button>
              <button onClick={()=>{setShowQuizModal(true);}}
                className="flex items-center gap-2 px-4 py-3 rounded-full bg-white/30 border border-white/40 text-xs font-black uppercase tracking-widest hover:bg-white/50 transition-all"
                title="Voir les résultats">
                <Eye size={16}/>Résultats
              </button>
            </div>
          </div>
          {showQuizModal&&(
            <QuestionnaireModal
              isOpen={showQuizModal}
              onClose={()=>setShowQuizModal(false)}
              config={config}
              siteUsers={users}
              userEmail={users.find((u:any)=>u.id===users[0]?.id)?.id||''}
            />
          )}
        </div>
      )}

      {tab==='settings'&&(
        <div className="space-y-8">
          <AutoSaveSettings localC={localC} save={save} config={config} setLocalC={setLocalC} fileRef={fileRef} handleFile={handleFile} lockedPagesMap={lockedPagesMap||{}} onSaveMaintenance={onSaveMaintenance}/>

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

const SemainierView = ({config, recipes, isPremium, onShowFreemium, onOpenRecipe}:{config:SiteConfig, recipes:Recipe[], isPremium?:boolean, onShowFreemium?:()=>void, onOpenRecipe?:(recipeId:string)=>void}) => {
  const [data, setData] = useState<Record<string,any>>({});
  const [weekOffset, setWeekOffset] = useState(0);
  const [modal, setModal] = useState<{day:string,meal:string}|null>(null);
  const [form, setForm] = useState({platName:'',participants:[] as string[],recetteLink:'',notes:''});
  const [toast, setToast] = useState('');
  const [dragOver, setDragOver] = useState<string|null>(null);
  const [showQuickBar, setShowQuickBar] = useState(true);
  const [dragSource, setDragSource] = useState<{key:string,meal:any}|null>(null);
  const [favSelected, setFavSelected] = useState<number|null>(null);

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
    // Push Google Calendar (silencieux si non lié)
    if(entry.day && entry.weekKey) {
      // Reconstruire une date approximative depuis day+weekKey (ex: "Lundi_2026_W12")
      const jourIndex = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'].indexOf(entry.day);
      const wkParts = entry.weekKey.match(/^(\d{4})_W(\d+)$/);
      if(wkParts && jourIndex >= 0) {
        const year = parseInt(wkParts[1]), week = parseInt(wkParts[2]);
        const jan4 = new Date(year, 0, 4);
        const mon = new Date(jan4.getTime() - ((jan4.getDay()||7)-1)*86400000 + (week-1)*7*86400000);
        const eventDate = new Date(mon.getTime() + jourIndex*86400000 + (entry.mealTime==='Midi'?12:19)*3600000);
        pousserVersGoogleCalendar(`🍽 ${entry.platName}`, eventDate.toISOString());
      }
    }
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
    // Récupère le recipeId si la recette vient des favoris
    const selectedFavIdx = favSelectVal !== '' ? parseInt(favSelectVal) : -1;
    const recipeId = selectedFavIdx >= 0 ? (favs[selectedFavIdx]?.recipeId || '') : '';
    await saveEntry(key,{platName:form.platName,participants:form.participants,recetteLink:form.recetteLink,notes:form.notes,recipeId});
    setModal(null);
    showToast('🍽️ Repas enregistré !');
  };

  const deleteMeal = async (day:string, meal:string, e:React.MouseEvent) => {
    e.stopPropagation();
    await deleteEntry(makeKey(day,meal,weekOffset));
    showToast('🗑️ Repas supprimé');
  };

  const [favSelectVal, setFavSelectVal] = useState('');

  const loadFav = (fav:any, idx:number) => {
    setForm(f=>({...f,platName:fav.platName,recetteLink:fav.recetteLink||'',notes:fav.notes||''}));
    setFavSelected(idx);
    setFavSelectVal(String(idx));
  };

  // Sur mobile : sélection d'un favori → pré-remplit le formulaire
  const onFavSelect = (idxStr:string) => {
    if(idxStr==='') return;
    setFavSelectVal(idxStr);
    const fav = favs[parseInt(idxStr)];
    if(fav) loadFav(fav, parseInt(idxStr));
  };

  // Drop d'un repas d'une case vers une autre
  const handleCellDrop = async (e: React.DragEvent, targetDay: string, targetMeal: string) => {
    e.preventDefault();
    setDragOver(null);
    const platName = e.dataTransfer.getData('platName');
    const recetteLink = e.dataTransfer.getData('recetteLink');
    const sourceKey = e.dataTransfer.getData('sourceKey');
    if(!platName) return;
    const targetKey = makeKey(targetDay, targetMeal, weekOffset);
    // Si c'est un déplacement depuis une autre case (pas un fav)
    if(sourceKey && sourceKey !== targetKey) {
      // Copier vers la cible
      const sourceData = data[sourceKey];
      if(sourceData) {
        await saveEntry(targetKey, {...sourceData, day: targetDay, mealTime: targetMeal});
        // Supprimer la source si elle était une vraie case (pas un fav de la barre)
        if(!e.dataTransfer.getData('isFav')) {
          await deleteEntry(sourceKey);
        }
      }
    } else if(!sourceKey || e.dataTransfer.getData('isFav')==='true') {
      // C'est un fav ou une recette de la barre rapide
      await saveEntry(targetKey, {
        platName, recetteLink, notes:'',
        participants: Object.keys(data).length > 0
          ? (data[Object.keys(data)[0]]?.participants || [])
          : [],
        day: targetDay, mealTime: targetMeal, weekKey: makeKey(targetDay, targetMeal, weekOffset)
      });
    }
    showToast('🍽️ Repas déplacé !');
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
                      onClick={()=>{
                        // Si un fav est sélectionné dans la barre rapide → l'ajouter directement
                        if(favSelected!==null && favs[favSelected]) {
                          const f=favs[favSelected];
                          saveEntry(key,{platName:f.platName,recetteLink:f.recetteLink||'',notes:'',participants:[],day,mealTime:meal,weekKey:makeKey(day,meal,weekOffset)});
                          showToast(`🍽️ ${f.platName} ajouté`);
                          setFavSelected(null);setFavSelectVal('');
                          setForm(fm=>({...fm,platName:'',recetteLink:'',notes:''}));
                        } else {
                          openModal(day,meal);
                        }
                      }}
                      onDragOver={e=>{e.preventDefault();setDragOver(key);}}
                      onDragLeave={()=>setDragOver(null)}
                      onDrop={e=>handleCellDrop(e,day,meal)}
                      className={`p-2 relative cursor-pointer transition-all group align-top ${isDragTarget?'bg-blue-50 ring-2 ring-blue-400 ring-inset':'hover:bg-gray-50'}`}
                    >
                      {entry?(
                        <div className="p-2 rounded-xl min-h-[80px] flex flex-col gap-1" style={{backgroundColor:config.primaryColor+'15',borderLeft:`3px solid ${config.primaryColor}`}}>
                          <button onClick={e=>deleteMeal(day,meal,e)} className="absolute top-1 left-1 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center opacity-30 md:opacity-0 group-hover:opacity-100 transition-opacity z-10">×</button>
                          <div className="font-bold text-sm text-gray-800 leading-tight pr-5">{entry.platName}</div>
                          <div className="text-[10px] text-gray-500">{entry.participants?.join(', ')}</div>
                          {(entry.recetteLink||entry.recipeId)&&(
  <button
    onClick={e=>{
      e.stopPropagation();
      if(entry.recipeId && onOpenRecipe) {
        onOpenRecipe(entry.recipeId);
      } else if(entry.recetteLink) {
        window.open(entry.recetteLink,'_blank');
      }
    }}
    className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center text-[11px] opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
    style={{backgroundColor:config.primaryColor,color:'white'}}
    title={entry.recipeId ? 'Voir la recette' : 'Lien externe'}
  >
    {entry.recipeId ? '📖' : '🔗'}
  </button>
)}
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
      {/* Toggle barre rapide */}
      {favs.length>0&&(
        <div className="flex justify-end mb-1">
          <button
            onClick={()=>setShowQuickBar(v=>!v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-all"
          >
            <Star size={12}/> {showQuickBar ? 'Masquer les recettes' : 'Afficher les recettes'}
          </button>
        </div>
      )}
      {favs.length>0&&showQuickBar&&(
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 animate-in slide-in-from-top-2">
          <h4 className="font-black text-xs uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2">
            <Star size={14}/> Recettes — glissez ou cliquez
          </h4>
          <div className="flex flex-wrap gap-2">
            {favs.map((f,i)=>(
              <div
                key={i}
                draggable
                onDragStart={e=>{
                  e.dataTransfer.setData('platName',f.platName);
                  e.dataTransfer.setData('recetteLink',f.recetteLink||'');
                  e.dataTransfer.setData('isFav','true');
                }}
                onClick={()=>{
                  if(favSelected===i){
                    // Désélectionner
                    setFavSelected(null);
                    setFavSelectVal('');
                    setForm(f2=>({...f2,platName:'',recetteLink:'',notes:''}));
                  } else {
                    loadFav(f, i);
                    showToast("⭐ Recette sélectionnée — ouvre une case pour l'ajouter");
                  }
                }}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 border text-xs font-bold cursor-pointer transition-all select-none ${
                  favSelected===i
                    ? 'border-current text-white'
                    : 'border-gray-200 text-gray-700 bg-gray-50 hover:bg-gray-100'
                }`}
                style={favSelected===i ? {backgroundColor:'var(--primary,#a85c48)',borderColor:'var(--primary,#a85c48)'} : {}}
              >
                {favSelected===i && <CheckCircle2 size={12} className="shrink-0"/>}
                <ChefHat size={12} className="shrink-0"/>
                {f.platName}
              </div>
            ))}
          </div>
          {favSelected!==null&&(
            <p className="text-[10px] text-gray-400 mt-2 italic">
              ✅ Sélectionné — clique sur une case pour l'y ajouter directement
            </p>
          )}
        </div>
      )}

      {/* Modal ajout repas */}
      {modal&&(
        <div className="fixed inset-0 z-[500] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={()=>setModal(null)}>
          <div
            className="modal-glass rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-md space-y-4 overflow-y-auto"
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
                  className="w-full p-3 rounded-xl border-2 border-gray-200 bg-white/35 text-sm font-bold outline-none focus:border-black"
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
// ── Modal achat / recharge tokens ──
const TokenShopModal = ({ config, onClose, balance, isPremium, onRequestUpgrade }:{
  config:SiteConfig, onClose:()=>void, balance:number, isPremium:boolean, onRequestUpgrade:()=>void
}) => {
  const packs = [
    { tokens: 200,  label: '☕ Petit Coup de Boost',  price: '0,99 €',  color: 'border-gray-200' },
    { tokens: 600,  label: '⚡ Pack Semaine',          price: '1,99 €',  color: 'border-amber-300' },
    { tokens: 1500, label: '🔥 Pack Mensuel',          price: '3,99 €',  color: 'border-orange-400', popular: true },
  ];
  return (
    <div className="fixed inset-0 z-[400] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-[2.5rem] md:rounded-[2.5rem] p-8 w-full md:max-w-md shadow-2xl space-y-5" onClick={e=>e.stopPropagation()}>
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
        <div className="text-center space-y-1">
          <div className="text-4xl">🔥</div>
          <h2 className="font-black text-2xl tracking-tight">Tokens IA</h2>
          <p className="text-gray-500 text-sm">Solde actuel : <strong className={balance < 50 ? 'text-red-600' : 'text-gray-800'}>{balance.toLocaleString('fr-FR')} tokens</strong></p>
          {balance < 50 && <p className="text-xs text-red-500 font-bold animate-pulse">⚠️ Solde faible — l'IA est bloquée</p>}
        </div>
        {/* Reset mensuel info */}
        <div className={`rounded-2xl p-4 text-center text-sm border ${isPremium ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
          <Crown size={16} className={`inline mr-1.5 ${isPremium ? 'text-amber-500' : 'text-gray-400'}`} fill={isPremium ? '#f59e0b' : 'none'}/>
          <strong>{isPremium ? 'Premium' : 'Gratuit'}</strong> — reset mensuel : <strong>{isPremium ? '2 000' : '500'} tokens</strong>
          {!isPremium && (
            <button onClick={onRequestUpgrade} className="block mt-2 mx-auto text-xs font-bold underline text-amber-600 hover:text-amber-800">
              Passer Premium → 2 000 tokens/mois ☕
            </button>
          )}
        </div>
        {/* Packs tokens */}
        <div className="space-y-2">
          <p className="text-xs text-gray-400 font-bold uppercase tracking-wider text-center">Recharge immédiate</p>
          {packs.map(pack => (
            <div key={pack.tokens} className={`relative flex justify-between items-center p-4 rounded-2xl border-2 ${pack.popular ? 'border-orange-400 bg-orange-50' : pack.color + ' bg-white'} cursor-pointer hover:shadow-md transition-all`}
              onClick={()=>alert('💳 Paiement en ligne bientôt disponible !')}>
              {pack.popular && <span className="absolute -top-2.5 left-4 bg-orange-500 text-white text-[9px] font-black uppercase px-2 py-0.5 rounded-full">Populaire</span>}
              <div>
                <div className="font-black text-gray-800">{pack.label}</div>
                <div className="text-xs text-gray-400">+{pack.tokens.toLocaleString('fr-FR')} tokens</div>
              </div>
              <div className="font-black text-lg text-gray-800">{pack.price}</div>
            </div>
          ))}
        </div>
        <p className="text-center text-[10px] text-gray-300">Les tokens se rechargent aussi automatiquement chaque mois.</p>
        <button onClick={onClose} className="w-full py-3 rounded-2xl bg-gray-100 text-gray-500 font-bold hover:bg-gray-200 transition-colors">Fermer</button>
      </div>
    </div>
  );
};

// ── Modal gestion tokens admin ──
const TokenAdminModal = ({ config, user: targetUser, onClose }:{
  config:SiteConfig, user:{id:string,name:string}, onClose:()=>void
}) => {
  const [bal, setBal] = React.useState<number|null>(null);
  const [adding, setAdding] = React.useState('');
  React.useEffect(()=>{
    const ref = doc(db,'user_tokens',targetUser.id);
    const unsub = onSnapshot(ref, snap => {
      setBal(snap.exists() ? (snap.data().balance ?? 0) : 0);
    });
    return ()=>unsub();
  },[targetUser.id]);

  const adjust = async (delta: number) => {
    const ref = doc(db,'user_tokens',targetUser.id);
    const snap = await getDoc(ref);
    const cur = snap.exists() ? (snap.data().balance ?? 0) : 0;
    const newBal = Math.max(0, cur + delta);
    await setDoc(ref, { balance: newBal, resetMonth: snap.exists() ? snap.data().resetMonth : new Date().toISOString().slice(0,7) }, { merge: true });
  };

  return (
    <div className="fixed inset-0 z-[500] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[2rem] p-7 w-full max-w-sm shadow-2xl space-y-5" onClick={e=>e.stopPropagation()}>
        <div className="text-center">
          <div className="text-3xl mb-2">🪙</div>
          <h3 className="font-black text-xl tracking-tight">{targetUser.name}</h3>
          <p className="text-gray-400 text-xs">{targetUser.id}</p>
        </div>
        <div className="text-center bg-white/35 rounded-2xl py-5">
          <div className="text-4xl font-black text-gray-800">{bal !== null ? bal.toLocaleString('fr-FR') : '…'}</div>
          <div className="text-xs text-gray-400 mt-1">tokens actuels</div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[-200,-50,+50,+200].map(d=>(
            <button key={d} onClick={()=>adjust(d)}
              className={`py-2 rounded-xl font-black text-sm transition-all hover:scale-105 ${d<0?'bg-red-50 text-red-600 border border-red-200':'bg-green-50 text-green-700 border border-green-200'}`}>
              {d>0?'+':''}{d}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="number" placeholder="Montant libre…"
            value={adding} onChange={e=>setAdding(e.target.value)}
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-gray-400"
          />
          <button onClick={()=>{const n=parseInt(adding);if(!isNaN(n)){adjust(n);setAdding('');}}}
            className="px-4 rounded-xl font-black text-sm text-white transition-all"
            style={{backgroundColor:config.primaryColor}}>OK</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={()=>adjust(-(bal||0))}
            className="py-2 rounded-xl bg-gray-100 text-gray-500 font-bold text-xs hover:bg-gray-200">Vider</button>
          <button onClick={()=>adjust(1000-(bal||0))}
            className="py-2 rounded-xl bg-black text-white font-bold text-xs hover:bg-gray-800">Reset 1 000</button>
        </div>
        <button onClick={onClose} className="w-full py-3 rounded-2xl bg-white/35 text-gray-400 font-bold text-sm hover:bg-gray-100">Fermer</button>
      </div>
    </div>
  );
};

const FreemiumModal = ({ config, onClose, onUpgrade }:{config:SiteConfig,onClose:()=>void,onUpgrade:()=>void}) => (
  <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={onClose}>
    <div className="modal-glass rounded-t-[2.5rem] md:rounded-[2.5rem] p-8 w-full md:max-w-md shadow-2xl space-y-5" onClick={e=>e.stopPropagation()}>
      <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
      <div className="text-center">
        <div className="text-5xl mb-3">☕</div>
        <h2 className="font-black text-2xl tracking-tight" style={{color:config.primaryColor}}>CHAUD DEVANT</h2>
        <p className="font-black text-lg mt-2">Débloquez tous les services pour<br/>votre gestion familiale</p>
        <p className="text-3xl font-black mt-3" style={{color:config.primaryColor}}>pour 1 CAFÉ par mois !</p>
        <p className="text-xs text-gray-400 mt-1">soit 3,99 € / mois — annulable à tout moment</p>
      </div>
      <div className="space-y-2 bg-white/35 rounded-2xl p-4">
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

const WishlistView = ({ user, config, siteUsers, onModalChange, consumeTokens }: { user:User, config:SiteConfig, siteUsers:any[], onModalChange?:(open:boolean)=>void, consumeTokens?:(cost:number)=>Promise<boolean> }) => {
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
    // Vérification tokens (12 tokens pour url_context)
    if(consumeTokens) {
      const ok = await consumeTokens(12);
      if(!ok) { setUrlError('🔥 Tokens insuffisants (12 requis). Recharge mensuelle automatique.'); return; }
    }
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
        // Calcul du total : uniquement mes listes (pas les partagées)
        // Si liste active affichée → utiliser uniquement cette liste (quelle que soit la propriété)
        // Sinon → seulement les listes dont je suis owner
        const listsToSum = activeList
          ? [activeList]
          : lists.filter((l:any) => l.owner === user.email || l.createdBy === user.email || (!l.sharedWith || l.sharedWith.length === 0));
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
          <div className="modal-glass rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm space-y-4" onClick={e=>e.stopPropagation()}>
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
            <input value={newList.name} onChange={e=>setNewList(l=>({...l,name:e.target.value}))} placeholder="Nom de la liste..." className="w-full p-3 rounded-2xl bg-white/35 font-bold outline-none border-2 border-transparent focus:border-black" autoFocus/>
            {/* Catégorie : dropdown des catégories existantes + créer */}
            <div>
              <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-1.5">Catégorie</label>
              <select
                value={newList.category}
                onChange={e=>{ if(e.target.value==='__new__') { const c=prompt('Nom de la nouvelle catégorie :'); if(c?.trim()) setNewList(l=>({...l,category:c.trim()})); } else setNewList(l=>({...l,category:e.target.value})); }}
                className="w-full p-3 rounded-xl bg-white/35 font-bold outline-none border-2 border-transparent focus:border-black text-sm"
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
          <div className="modal-glass rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm space-y-4" onClick={e=>e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
            <h3 className="font-black text-xl">Modifier la WishList</h3>
            <div className="flex flex-wrap gap-2">
              {WISHLIST_ICONS.map(icon=>(
                <button key={icon} onClick={()=>setEditingList((l:any)=>({...l,icon}))} className={`text-2xl p-2 rounded-xl transition-all ${editingList.icon===icon?'bg-gray-900 scale-110':'bg-gray-100 hover:bg-gray-200'}`}>{icon}</button>
              ))}
            </div>
            <input value={editingList.name} onChange={e=>setEditingList((l:any)=>({...l,name:e.target.value}))} className="w-full p-3 rounded-2xl bg-white/35 font-bold outline-none border-2 border-transparent focus:border-black"/>
            <select
              value={editingList.category||''}
              onChange={e=>{ if(e.target.value==='__new__'){const c=prompt('Nouvelle catégorie :');if(c?.trim())setEditingList((l:any)=>({...l,category:c.trim()}));}else setEditingList((l:any)=>({...l,category:e.target.value})); }}
              className="w-full p-3 rounded-xl bg-white/35 font-bold outline-none text-sm"
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
              <div className="modal-glass rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm space-y-4" onClick={e=>e.stopPropagation()}>
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
              <div className="modal-glass rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm space-y-4" onClick={e=>e.stopPropagation()}>
                <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
                <h3 className="font-black text-xl">Ajouter un article</h3>
                <input value={newItem.name} onChange={e=>setNewItem(i=>({...i,name:e.target.value}))} placeholder="Nom du produit..." className="w-full p-3 rounded-2xl bg-white/35 font-bold outline-none border-2 border-transparent focus:border-black" autoFocus/>
                <div className="flex gap-3">
                  <input value={newItem.price} onChange={e=>setNewItem(i=>({...i,price:e.target.value}))} placeholder="💰 Prix — ex : 24,99 €" className="flex-1 p-3 rounded-2xl bg-amber-50 font-bold outline-none border-2 border-transparent focus:border-amber-400 text-sm" inputMode="decimal"/>
                </div>
                <input value={newItem.imageUrl} onChange={e=>setNewItem(i=>({...i,imageUrl:e.target.value}))} placeholder="URL image (facultatif)..." className="w-full p-3 rounded-2xl bg-white/35 font-bold outline-none text-sm"/>
                {newItem.imageUrl&&<img src={newItem.imageUrl} alt="" className="w-full h-32 object-cover rounded-2xl" onError={e=>(e.currentTarget.style.display='none')}/>}
                {newItem.url&&<div className="text-xs text-gray-400 truncate bg-white/35 px-3 py-2 rounded-xl"><Link size={10} className="inline mr-1"/>{newItem.url}</div>}
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
              <div className="modal-glass rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm space-y-4" onClick={e=>e.stopPropagation()}>
                <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
                <h3 className="font-black text-xl">Importer depuis un lien</h3>
                <p className="text-sm text-gray-500">Gemini accède à la page et extrait le nom, le prix et l'image.</p>
                <div className="flex gap-2">
                  <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&scrapeUrl()} placeholder="https://amazon.fr/..., ikea.com/..." className="flex-1 p-3 rounded-2xl bg-white/35 font-bold outline-none border-2 border-transparent focus:border-black text-sm" autoFocus/>
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
              <div className="modal-glass rounded-t-[2.5rem] md:rounded-[2.5rem] p-6 w-full md:max-w-sm space-y-4" onClick={e=>e.stopPropagation()}>
                <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2 md:hidden"/>
                <h3 className="font-black text-xl">Modifier l'article</h3>
                <input value={editingItem.name} onChange={e=>setEditingItem((i:any)=>({...i,name:e.target.value}))} className="w-full p-3 rounded-2xl bg-white/35 font-bold outline-none border-2 border-transparent focus:border-black" autoFocus/>
                <input value={editingItem.price||''} onChange={e=>setEditingItem((i:any)=>({...i,price:e.target.value}))} placeholder="Prix (ex: 24,99 €)..." className="w-full p-3 rounded-2xl bg-white/35 font-bold outline-none text-sm border-2 border-transparent focus:border-black"/>
                <input value={editingItem.imageUrl||''} onChange={e=>setEditingItem((i:any)=>({...i,imageUrl:e.target.value}))} placeholder="URL image..." className="w-full p-3 rounded-2xl bg-white/35 font-bold outline-none text-sm"/>
                <input value={editingItem.url||''} onChange={e=>setEditingItem((i:any)=>({...i,url:e.target.value}))} placeholder="Lien produit..." className="w-full p-3 rounded-2xl bg-white/35 font-bold outline-none text-sm"/>
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
// ── Google Calendar : lier l'agenda + pousser un événement ──
const lierAgenda = async (userEmail?: string): Promise<boolean> => {
  return new Promise<boolean>((resolve) => {
    const gis = (window as any).google?.accounts?.oauth2;
    if (!gis) {
      alert("⚠️ Le script Google n'est pas chargé. Rechargez la page.");
      resolve(false); return;
    }
    if (!GOOGLE_CLIENT_ID) {
      // GIS non dispo : fallback silencieux sur signInWithPopup
      signInWithPopup(auth, googleCalendarProvider)
        .then(result => {
          const credential = GoogleAuthProvider.credentialFromResult(result);
          const token = credential?.accessToken;
          if(token){
            localStorage.setItem('gcal_token', token);
            localStorage.setItem('gcal_expiry', String(Date.now() + 55*60*1000));
            if(userEmail) setDoc(doc(db,'gcal_links',userEmail),{linked:true,linkedAt:new Date().toISOString()},{merge:true});
            resolve(true);
          } else resolve(false);
        })
        .catch(() => resolve(false));
      return;
    }
    const tokenClient = gis.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      callback: async (resp: any) => {
        if (resp.error) { resolve(false); return; }
        const token: string = resp.access_token;
        const expiry = Date.now() + (resp.expires_in - 60) * 1000;
        localStorage.setItem('gcal_token', token);
        localStorage.setItem('gcal_expiry', String(expiry));
        if (userEmail) {
          await setDoc(doc(db, 'gcal_links', userEmail), {
            linked: true, linkedAt: new Date().toISOString()
          }, { merge: true });
        }
        resolve(true);
      },
      error_callback: () => resolve(false),
    });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
};


// Récupère le token gcal valide (null si expiré ou absent)
const getGcalToken = (): string | null => {
  const token = localStorage.getItem('gcal_token');
  const expiry = parseInt(localStorage.getItem('gcal_expiry') || '0');
  if (!token || Date.now() > expiry) {
    localStorage.removeItem('gcal_token');
    localStorage.removeItem('gcal_expiry');
    return null;
  }
  return token;
};

const pousserVersGoogleCalendar = async (titre: string, dateIso: string, description?: string, allDay?: boolean) => {
  const token = getGcalToken();
  if (!token) return;
  let payload: any;
  if (allDay) {
    const dateStr = dateIso.split('T')[0]; // YYYY-MM-DD
    const lendemain = new Date(dateStr);
    lendemain.setDate(lendemain.getDate() + 1);
    payload = {
      summary: titre,
      description: description || 'Depuis Chaud Devant 🔥',
      start: { date: dateStr },
      end:   { date: lendemain.toISOString().split('T')[0] }
    };
  } else {
    const debut = new Date(dateIso);
    const fin   = new Date(debut.getTime() + 60 * 60 * 1000);
    payload = {
      summary: titre,
      description: description || 'Depuis Chaud Devant 🔥',
      start: { dateTime: debut.toISOString(), timeZone: 'Europe/Paris' },
      end:   { dateTime: fin.toISOString(),   timeZone: 'Europe/Paris' }
    };
  }
  try {
    const rep = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!rep.ok) {
      if (rep.status === 401) {
        localStorage.removeItem('gcal_token');
        localStorage.removeItem('gcal_expiry');
      }
    }
  } catch (e) {
    console.error('Google Calendar réseau :', e);
  }
};

const pousserTacheVersGoogleCalendar = async (titre: string, dateIso: string) => {
  const token = getGcalToken();
  if (!token) return;
  const date = dateIso.split('T')[0]; // YYYY-MM-DD
  const lendemain = new Date(date);
  lendemain.setDate(lendemain.getDate() + 1);
  const payload = {
    summary: `☑ ${titre}`,
    description: 'Tâche depuis Chaud Devant 🔥',
    start: { date },
    end:   { date: lendemain.toISOString().split('T')[0] }
  };
  try {
    const rep = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!rep.ok && rep.status === 401) {
      localStorage.removeItem('gcal_token');
      localStorage.removeItem('gcal_expiry');
    }
  } catch (e) { /* silencieux */ }
};


// ==========================================
// TÂCHES MÉNAGÈRES — Vue mois (composant séparé obligatoire pour les hooks)
// ==========================================
const TasksChoresView = ({ config, myLetter, choreStatus, toggleChore }: {
  config: SiteConfig;
  myLetter: string | null;
  choreStatus: Record<string, any>;
  toggleChore: (weekId: string, letter: string) => Promise<void>;
}) => {
  const [tasksMonthOffset, setTasksMonthOffset] = React.useState(0);
  const MOIS_FR_TASKS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const targetDate = new Date(new Date().getFullYear(), new Date().getMonth() + tasksMonthOffset, 1);

  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-8" id="tasks-table">
      <div className="text-center space-y-4">
        <h2 className="text-2xl md:text-5xl font-black tracking-tight" style={{color:config.primaryColor}}>TÂCHES MÉNAGÈRES</h2>
        <p className="text-gray-500 font-serif italic">
          {myLetter ? `Salut ${myLetter==='G'?'Gabriel':myLetter==='P'?'Pauline':'Valentin'}, à l'attaque !` : "Connecte-toi avec ton compte perso."}
        </p>
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={()=>setTasksMonthOffset(o=>o-1)}
            className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-all"
          >
            <ArrowLeft size={16}/>
          </button>
          <span className="font-black text-base tracking-tight" style={{color:config.primaryColor}}>
            {MOIS_FR_TASKS[targetDate.getMonth()]} {targetDate.getFullYear()}
          </span>
          <button
            onClick={()=>setTasksMonthOffset(o=>o+1)}
            className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-all"
          >
            <ArrowLeft size={16} className="rotate-180"/>
          </button>
        </div>
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
              {getMonthWeekends(tasksMonthOffset).map((week, i) => {
                const rowStatus = choreStatus[week.id] || {};
                const isRowComplete = rowStatus.G && rowStatus.P && rowStatus.V;
                const now = new Date();
                const isLocked = week.fullDate.getTime() > (now.getTime() + 86400000 * 6);
                return (
                  <tr key={i} className={`transition-colors ${isRowComplete?'bg-green-50/50':'hover:bg-white/50'}`}>
                    <td className="p-4 font-mono font-bold text-gray-700 whitespace-nowrap text-sm">
                      {week.dateStr}{isLocked && <span className="ml-2 text-xs text-gray-300">🔒</span>}
                    </td>
                    <TaskCell weekId={week.id} letter={week.haut} label="Aspi Haut" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter}/>
                    <TaskCell weekId={week.id} letter={week.bas} label="Aspi Bas" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter}/>
                    <TaskCell weekId={week.id} letter={week.douche} label="Lavabo" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter}/>
                    <td className="p-4 text-center">
                      {isRowComplete && <CheckCircle2 className="text-green-500 mx-auto animate-bounce"/>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="p-6 bg-white/35 text-center text-xs text-gray-400 uppercase tracking-widest border-t border-gray-100">
          G = Gabriel • P = Pauline • V = Valentin
        </div>
      </div>
    </div>
  );
};

// ==========================================
// PANEL COMMUNICATION
// ==========================================
const CommPanel = ({ config, user, onClose }: { config: SiteConfig, user: User, onClose: () => void }) => {
  const [suggestion, setSuggestion] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  const sendSuggestion = async () => {
    if(!suggestion.trim()) return;
    setSending(true);
    try {
      await addDoc(collection(db, 'suggestions'), {
        message: suggestion.trim(),
        from: user.email,
        fromName: user.displayName || user.email,
        createdAt: new Date().toISOString(),
        read: false,
      });
      // Notif à l'admin
      await addDoc(collection(db, 'notifications'), {
        message: `💡 Suggestion de ${user.displayName||user.email} : "${suggestion.trim().slice(0,80)}${suggestion.length>80?'…':''}"`,
        type: 'info', repeat: 'once',
        targets: [ADMIN_EMAIL],
        createdAt: new Date().toISOString(),
        readBy: {},
      });
      setSent(true);
      setSuggestion('');
      setTimeout(() => setSent(false), 3000);
    } catch { /* silencieux */ }
    setSending(false);
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-sm h-full modal-glass animate-in slide-in-from-right flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-black text-sm" style={{backgroundColor:config.primaryColor}}>?</div>
            <h3 className="font-black text-lg">Communication</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/30 text-gray-400"><X size={18}/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Contact Admin */}
          <div className="glass-element p-5 space-y-3">
            <h4 className="font-black text-sm uppercase tracking-widest text-gray-400 flex items-center gap-2">
              <Mail size={14}/> Contact administrateur
            </h4>
            <p className="text-sm text-gray-600">Pour toute question ou problème, contactez Gabriel directement :</p>
            <a
              href="mailto:gabriel.frezouls@gmail.com"
              className="flex items-center gap-3 p-4 bg-white rounded-2xl border border-gray-100 hover:shadow-md transition-all group"
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm shrink-0" style={{backgroundColor:config.primaryColor}}>G</div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-gray-800">Gabriel Frézouls</div>
                <div className="text-xs text-blue-500 truncate group-hover:underline">gabriel.frezouls@gmail.com</div>
              </div>
              <ExternalLink size={14} className="text-gray-300 shrink-0"/>
            </a>
            <a
              href="mailto:gabriel.frezouls@gmail.com"
              className="w-full flex items-center justify-center gap-2 py-3 text-white rounded-2xl font-bold text-sm hover:scale-105 transition-transform"
              style={{backgroundColor:config.primaryColor}}
            >
              <Mail size={16}/> Envoyer un email
            </a>
          </div>

          {/* Suggestion */}
          <div className="glass-element p-5 space-y-3">
            <h4 className="font-black text-sm uppercase tracking-widest text-gray-400 flex items-center gap-2">
              <Sparkles size={14}/> Suggestion / Conseil
            </h4>
            <p className="text-xs text-gray-400">Partagez vos idées d'amélioration pour l'application !</p>
            <textarea
              value={suggestion}
              onChange={e=>setSuggestion(e.target.value)}
              placeholder="Ex: J'aimerais pouvoir... / Il serait utile de..."
              className="w-full p-4 rounded-2xl bg-white/40 border border-white/50 text-sm font-bold outline-none resize-none h-28 focus:border-white/70 transition-all"
            />
            {sent && (
              <div className="text-center text-xs font-bold py-2 px-3 rounded-xl bg-green-50 text-green-700">
                ✅ Suggestion envoyée ! Merci.
              </div>
            )}
            <button
              onClick={sendSuggestion}
              disabled={!suggestion.trim() || sending}
              className="w-full flex items-center justify-center gap-2 py-3 bg-black text-white rounded-2xl font-bold text-sm disabled:opacity-40 hover:scale-105 transition-transform"
            >
              {sending ? <Loader2 size={16} className="animate-spin"/> : <Send size={16}/>}
              {sending ? 'Envoi…' : 'Envoyer ma suggestion'}
            </button>
          </div>

          {/* Version info */}
          <div className="text-center text-[10px] text-gray-300 space-y-1">
            <div className="font-bold uppercase tracking-widest">Chaud Devant Family</div>
            <div>Version 3.2 — Propulsé par Gemini IA</div>
          </div>
        </div>
      </div>
    </div>
  );
};

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
const [siteUsersLoading, setSiteUsersLoading] = useState(true);
  const [usersMapping, setUsersMapping] = useState<Record<string,string>>({});
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [selectedXSite, setSelectedXSite] = useState<any>(null);
  const [newEvent, setNewEvent] = useState({title:'',date:new Date().toISOString().split('T')[0],time:'',isAllDay:true});
  const defaultRecipeState = {id:'',title:'',description:'',chef:'',ingredients:'',steps:'',category:'plat',image:'',prepTime:'',cookTime:'',servings:4};
  const [currentRecipe, setCurrentRecipe] = useState<any>(defaultRecipeState);
  const [recipeView, setRecipeView] = useState<'list'|'read'>('list');
  const [readingRecipe, setReadingRecipe] = useState<any>(null);
  const [recipeFilter, setRecipeFilter] = useState('');
  const [recipeCategory, setRecipeCategory] = useState('all');
  const [currentView, setCurrentView] = useState<string>('home');
  const [pendingQuizId, setPendingQuizId] = useState<string|null>(null); // quiz à afficher post-login
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [chatHistory, setChatHistory] = useState<{role:string,text:string}[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showFreemiumModal, setShowFreemiumModal] = useState(false);
  const [wishlistModalOpen, setWishlistModalOpen] = useState(false);
  const [xsiteData, setXsiteData] = useState<Record<string,string>>({}); // données localStorage xsite
  const xsiteIframeRef = useRef<HTMLIFrameElement>(null);
  const [tokenBalance, setTokenBalance] = useState<number|null>(null);
  const [showTokenShop, setShowTokenShop] = useState(false);   // modal achat tokens
  const [adminTokenUser, setAdminTokenUser] = useState<{id:string,name:string}|null>(null); // modal tokens admin
  const [showCommPanel, setShowCommPanel] = useState(false);
  const [githubConfig, setGithubConfig] = useState<{owner:string,repo:string,branch:string}|null>(null);

  // ── XSite : intercepter localStorage de l'iframe via postMessage ──
  useEffect(() => {
    if (!user?.email || !selectedXSite) return;
    const siteKey = `${user.email}_${selectedXSite.id}`;
    // Charger les données sauvegardées depuis Firestore
    const loadData = async () => {
      const snap = await getDoc(doc(db, 'xsite_data', siteKey));
      const saved = snap.exists() ? (snap.data() as Record<string,string>) : {};
      setXsiteData(saved);
      // Les données sont envoyées via onLoad de l'iframe
    };
    loadData();
    // Écouter les messages de l'iframe
    // Buffer local pour debouncer les écritures Firestore
    let pendingData: Record<string,string> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const flushToFirestore = async (data: Record<string,string>) => {
      // merge:true pour ne pas écraser les clés non modifiées
      await setDoc(doc(db, 'xsite_data', siteKey), data, { merge: true });
    };

    const onMsg = async (e: MessageEvent) => {
      if (!e.data?.type) return;

      // L'iframe signale qu'elle est prête : envoyer les données initiales
      if (e.data.type === 'XSITE_READY') {
        const snap = await getDoc(doc(db, 'xsite_data', siteKey));
        const saved = snap.exists() ? (snap.data() as Record<string,string>) : {};
        setXsiteData(saved);
        pendingData = { ...saved };
        xsiteIframeRef.current?.contentWindow?.postMessage({ type: 'XSITE_INIT', data: saved }, '*');
        return;
      }

      // L'iframe sauvegarde une valeur
      if (e.data.type === 'XSITE_SET') {
        const { key, value } = e.data;
        // Mise à jour locale immédiate
        pendingData = { ...(pendingData || {}), [key]: value };
        setXsiteData({ ...pendingData });
        // Debounce : écrire Firestore 400ms après le dernier setItem
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (pendingData) flushToFirestore(pendingData);
        }, 400);
      }
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [selectedXSite, user?.email]);

  // Helper : l'utilisateur courant est-il premium ?
  const isCurrentUserPremium = () => {
    if(!user?.email) return false;
    const u = siteUsers.find(u=>u.id===user.email);
    return u?.plan==='pro' || u?.plan==='premium';
  };

  // ── Consommer des tokens IA ──
  // Retourne true si OK, false si solde insuffisant
  const consumeTokens = async (cost: number): Promise<boolean> => {
    if(!user?.email) return false;
    const ref = doc(db,'user_tokens',user.email);
    const snap = await getDoc(ref);
    const now = new Date();
    const currentMonth = now.toISOString().slice(0,7); // "2026-03"
    let data = snap.exists() ? snap.data() : null;
    // Reset mensuel si nouveau mois
    if(!data || data.resetMonth !== currentMonth) {
      const userDoc = siteUsers.find(u => u.id === user?.email);
      const isPro = userDoc?.plan === 'pro' || userDoc?.plan === 'premium';
      const resetBal = isPro ? TOKEN_PRO_RESET : TOKEN_FREE_RESET;
      data = { balance: data ? resetBal : TOKEN_WELCOME, resetMonth: currentMonth };
      await setDoc(ref, data);
    }
    if(data.balance < cost) return false; // Solde insuffisant
    await updateDoc(ref,{ balance: data.balance - cost });
    setTokenBalance(data.balance - cost);
    return true;
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
      getDoc(doc(db,'site_config','github')).then(snap=>{
  if(snap.exists()) setGithubConfig(snap.data() as any);
}).catch(()=>{});
        try{
          await setDoc(doc(db,'site_users',u.email),{lastLogin:new Date().toISOString(),email:u.email},{merge:true});
          const prefsDoc=await getDoc(doc(db,'user_prefs',u.email));
          if(prefsDoc.exists()){
  setFavorites(prefsDoc.data().favorites||[]);
}
// Traiter les événements gcal en attente pour cet utilisateur
const pendingSnap = await getDocs(
  query(collection(db,'gcal_pending_events'),
    where('targetEmail','==', u.email),
    where('processed','==', false)
  )
);
if(!pendingSnap.empty) {
  const token = getGcalToken();
  if(token) {
    for(const pendingDoc of pendingSnap.docs) {
      const ev = pendingDoc.data();
      try {
        await pousserVersGoogleCalendar(ev.titre, ev.dateIso, ev.description, ev.allDay);
        await updateDoc(doc(db,'gcal_pending_events', pendingDoc.id), { processed: true });
      } catch { /* silencieux */ }
    }
  }
}
          // Vérifier si un quiz est en attente et n'a pas encore été fait/passé
          const prefs = prefsDoc.exists() ? prefsDoc.data() : {};
          const quizSnap = await getDocs(collection(db,'questionnaires'));
          quizSnap.docs.forEach(qd=>{
            const qid = qd.id;
            const alreadyDone      = !!prefs[`quiz_done_${qid}`];
            const alreadySkipped   = !!prefs[`quiz_skipped_${qid}`];
            // quiz_postponed → on l'affiche quand même (c'est le but du report)
            // et on efface le flag postponed pour cette session
            if(!alreadyDone && !alreadySkipped){
              setPendingQuizId(qid);
              // Effacer le flag postponed maintenant qu'on l'affiche
              if(prefs[`quiz_postponed_${qid}`]) {
                setDoc(doc(db,'user_prefs',u.email!),
                  {[`quiz_postponed_${qid}`]: false},
                  {merge:true}
                ).catch(()=>{});
              }
            }
          });
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
    const unsubU=onSnapshot(collection(db,'site_users'),s=>{const users=s.docs.map(d=>({id:d.id,...d.data()}));setSiteUsers(users);setSiteUsersLoading(false);const newMap:Record<string,string>={};users.forEach((u:any)=>{if(u.letter)newMap[u.id]=u.letter;});setUsersMapping(newMap);},ignoreError);
    // Écouter le solde de tokens en temps réel
    const unsubTokens = onSnapshot(doc(db,'user_tokens',user.email!), async snap => {
      const now = new Date();
      const currentMonth = now.toISOString().slice(0,7);
      if(snap.exists()) {
        const data = snap.data();
        if(data.resetMonth !== currentMonth) {
          // Nouveau mois → reset
          const isPro = siteUsers.find(u=>u.id===user.email)?.plan === 'pro' || siteUsers.find(u=>u.id===user.email)?.plan === 'premium';
          await setDoc(doc(db,'user_tokens',user.email!),{ balance: isPro ? TOKEN_PRO_RESET : TOKEN_FREE_RESET, resetMonth: currentMonth });
        } else {
          setTokenBalance(data.balance ?? TOKEN_WELCOME);
        }
      } else {
        // Première connexion → tokens de bienvenue
        await setDoc(doc(db,'user_tokens',user.email!),{ balance: TOKEN_WELCOME, resetMonth: currentMonth });
        setTokenBalance(TOKEN_WELCOME);
      }
    });
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
    return()=>{unsubC();unsubM();unsubX();unsubR();unsubE();unsubV();unsubT();unsubU();unsubN();unsubTokens();};
  },[user]);

  // DEEP LINKING — stocke les paramètres URL au mount, résout quand xsitePages est chargé
const [pendingXSiteId, setPendingXSiteId] = useState<string|null>(null);
const [pendingAnchor, setPendingAnchor] = useState<string|null>(null);

// Capture des paramètres URL au montage (une seule fois)
useEffect(()=>{
  const params=new URLSearchParams(window.location.search);
  const targetView=params.get('view');
  if(targetView){
    setCurrentView(targetView);
    if(targetView==='xsite'){
      const siteId=params.get('id');
      if(siteId) setPendingXSiteId(siteId); // stocke pour résolution ultérieure
    }
    const anchorId=params.get('anchor');
    if(anchorId) setPendingAnchor(anchorId);
    window.history.replaceState({},document.title,window.location.pathname);
  }
},[]); // dépend uniquement du mount

// Résolution du XSite une fois xsitePages disponible
useEffect(()=>{
  if(pendingXSiteId && xsitePages.length>0){
    const found=xsitePages.find(p=>p.id===pendingXSiteId);
    if(found){ setSelectedXSite(found); setPendingXSiteId(null); }
  }
},[xsitePages, pendingXSiteId]);

// Résolution de l'ancre après navigation
useEffect(()=>{
  if(pendingAnchor){
    const timer=setTimeout(()=>{
      const el=document.getElementById(pendingAnchor);
      if(el){
        el.scrollIntoView({behavior:'smooth',block:'start'});
        el.classList.add('ring-4','ring-offset-2','ring-orange-400','transition-all','duration-1000');
        setTimeout(()=>el.classList.remove('ring-4','ring-offset-2','ring-orange-400'),2000);
      }
      setPendingAnchor(null);
    },800);
    return ()=>clearTimeout(timer);
  }
},[pendingAnchor, currentView]);

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
  const handleArchitect=async()=>{
    if(!aiPrompt.trim())return;
    const ok = await consumeTokens(20);
    if(!ok){alert('🔥 Tokens insuffisants (20 requis pour l\'Architecte).');return;}
    setIsAiLoading(true);const n=await askAIArchitect(aiPrompt,config);if(n)await saveConfig({...config,...n},true);setIsAiLoading(false);
  };
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
  // Support quiz : détecter ?quiz=id dans l'URL et stocker pour post-login
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const id = p.get('quiz');
    if(id) {
      setPendingQuizId(id);
      // Nettoyer l'URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  if(isInitializing || siteUsersLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f9f9f9]">
      <div className="flex flex-col items-center" style={{position:'relative'}}>
        <style>{`
          @keyframes cd-bounce{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-25px) scale(1.05)}}
          @keyframes cd-shadow{0%,100%{transform:scale(1);opacity:.2}50%{transform:scale(.5);opacity:.05}}
          @keyframes cd-pulse{0%,100%{opacity:1}50%{opacity:.5}}
          .cd-logo{width:120px;height:auto;animation:cd-bounce 2s infinite ease-in-out;filter:drop-shadow(0 4px 6px rgba(0,0,0,.05))}
          .cd-shadow{width:70px;height:10px;background:rgba(0,0,0,.15);border-radius:50%;margin-top:16px;animation:cd-shadow 2s infinite ease-in-out}
          .cd-text{margin-top:24px;color:#a85c48;font-weight:700;font-size:1rem;letter-spacing:3px;text-transform:uppercase;animation:cd-pulse 2s infinite ease-in-out;font-family:'Inter',sans-serif}
        `}</style>
        <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%94%A5%3C/text%3E%3C/svg%3E" alt="Logo" className="cd-logo"/>
        <div className="cd-shadow"/>
        <div className="cd-text">En cuisine…</div>
      </div>
    </div>
  );

  if(!user) return (
    <div className="fixed inset-0 flex flex-col items-center justify-center p-6 bg-[#f5ede7]">
      
      <div className="z-10 text-center space-y-8 animate-in fade-in zoom-in duration-700">
        <div className="mx-auto w-24 h-24 rounded-[2.5rem] flex items-center justify-center shadow-xl bg-[#a85c48]"><Sparkles className="text-white" size={48}/></div>
        <h1 className="text-4xl font-cinzel font-black tracking-widest text-[#a85c48]">CHAUD DEVANT</h1>
        <button onClick={handleLogin} className="bg-white text-black font-black py-4 px-8 rounded-2xl shadow-xl flex items-center gap-3 hover:scale-105 transition-transform"><LogIn size={24}/>CONNEXION GOOGLE</button>
      </div>
    </div>
  );

  if(!isAuthorized && !siteUsersLoading) return (
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
    <div className="min-h-screen pb-24 md:pb-0 transition-colors duration-700" style={{backgroundColor:"var(--warm-200)"}}>

      {/* ── QUIZ POST-LOGIN ── */}
      {pendingQuizId && user && (
        <div className="fixed inset-0 z-[600] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="modal-glass w-full max-w-2xl rounded-[2.5rem] overflow-hidden" style={{maxHeight:'90vh'}}>
            <div className="overflow-y-auto" style={{maxHeight:'90vh'}}>
              {/* Header avec bouton Passer */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-white/20"
                style={{background:'rgba(242,237,228,0.92)',backdropFilter:'blur(20px)'}}>
                <p className="text-xs font-black uppercase tracking-widest text-gray-500">Questionnaire</p>
                <div className="flex items-center gap-2">
                  {/* Bouton Horloge : reporter à la prochaine connexion */}
                  <button
                    onClick={async () => {
                      if(user?.email && pendingQuizId) {
                        try {
                          // quiz_postponed = true → sera re-affiché au prochain login
                          // (on ne met PAS quiz_skipped, donc le quiz sera re-vérifié)
                          await setDoc(doc(db,'user_prefs',user.email),
                            {[`quiz_postponed_${pendingQuizId}`]: true},
                            {merge:true}
                          );
                        } catch {}
                      }
                      setPendingQuizId(null);
                    }}
                    className="w-8 h-8 rounded-full bg-white/40 border border-white/50 flex items-center justify-center hover:bg-white/60 transition-all"
                    title="Reporter à la prochaine connexion"
                  >
                    <Clock size={14} className="text-gray-500"/>
                  </button>
                  {/* Bouton Passer : ignorer définitivement */}
                  <button
                    onClick={async () => {
                      if(user?.email && pendingQuizId) {
                        try {
                          await setDoc(doc(db,'user_prefs',user.email),
                            {[`quiz_skipped_${pendingQuizId}`]: true},
                            {merge:true}
                          );
                        } catch {}
                      }
                      setPendingQuizId(null);
                    }}
                    className="px-4 py-2 rounded-full bg-white/40 border border-white/50 text-xs font-bold uppercase tracking-wider hover:bg-white/60 transition-all"
                  >
                    Passer →
                  </button>
                </div>
              </div>
              {/* Contenu du quiz (réutilise le composant PublicQuiz sans le layout full-page) */}
              <InlineQuiz
                formId={pendingQuizId}
                config={config}
                userEmail={user?.email||''}
                onDone={async () => {
                  if(user?.email) {
                    try {
                      await setDoc(doc(db,'user_prefs',user.email),
                        {[`quiz_done_${pendingQuizId}`]: true},
                        {merge:true}
                      );
                    } catch {}
                  }
                  setPendingQuizId(null);
                }}
              />
            </div>
          </div>
        </div>
      )}

      

      {/* NOTIFICATIONS PANEL */}
      {isNotifOpen&&(
        <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm flex justify-end" onClick={()=>setIsNotifOpen(false)}>
          <div className="w-full max-w-sm modal-glass h-full p-6 animate-in slide-in-from-right shadow-2xl overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-6 px-1">
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
          <iframe ref={xsiteIframeRef}
          srcDoc={(() => {
            const rawBase = githubConfig?.owner && githubConfig?.repo
  ? `https://raw.githubusercontent.com/${githubConfig.owner}/${githubConfig.repo}/${githubConfig.branch||'main'}/`
  : '';

const interceptScript = `<script>
(function() {
  var _store = {};
  var _rawBase = ${JSON.stringify(rawBase)};
  // API publique pour les codes XSite
  window.XSite = {
    save: function(key, value) {
      _store[String(key)] = String(value);
      try { parent.postMessage({ type: 'XSITE_SET', key: String(key), value: String(value) }, '*'); } catch(e) {}
    },
    load: function(key) { return _store[String(key)] !== undefined ? _store[String(key)] : null; },
    saveAll: function(obj) {
      Object.keys(obj).forEach(function(k) { window.XSite.save(k, obj[k]); });
    },
    loadAll: function() { return Object.assign({}, _store); },
    asset: function(path) {
      if(!_rawBase) { console.warn('XSite.asset: aucun dépôt GitHub configuré.'); return path; }
      return _rawBase + path.replace(/^\\//, '');
    },
    img: function(path, alt) {
      var el = document.createElement('img');
      el.src = window.XSite.asset(path);
      el.alt = alt || '';
      return el;
    }
  };
  // Proxy localStorage → même API (pour les sites existants)
  try {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: function(k) { return _store[k] !== undefined ? _store[k] : null; },
        setItem: function(k, v) { window.XSite.save(k, v); },
        removeItem: function(k) { delete _store[k]; },
        clear: function() { _store = {}; },
        get length() { return Object.keys(_store).length; },
        key: function(i) { return Object.keys(_store)[i] || null; }
      },
      writable: false, configurable: true
    });
  } catch(e) {}
  // Recevoir données initiales
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'XSITE_INIT') {
      _store = Object.assign({}, e.data.data || {});
      window.dispatchEvent(new CustomEvent('xsite-ready', { detail: _store }));
    }
  });
  // Signaler au parent que le script est prêt à recevoir XSITE_INIT
  try { parent.postMessage({ type: 'XSITE_READY' }, '*'); } catch(e) {}
})();
<\/script>`;
            const html = selectedXSite.html || '';
            return html.includes('<head>') ? html.replace('<head>', '<head>' + interceptScript) : interceptScript + html;
          })()}
          className="flex-1 w-full border-none"
          title={selectedXSite.name}
          onLoad={() => {
            // Fallback : si XSITE_READY n'arrive pas dans 800ms, envoyer quand même
            if(!user?.email || !selectedXSite?.id) return;
            const siteKey = `${user.email}_${selectedXSite.id}`;
            setTimeout(async () => {
              const snap = await getDoc(doc(db,'xsite_data', siteKey));
              const saved = snap.exists() ? (snap.data() as Record<string,string>) : {};
              xsiteIframeRef.current?.contentWindow?.postMessage({ type:'XSITE_INIT', data: saved },'*');
            }, 800);
          }}
          sandbox="allow-scripts"/>
        </div>
      )}

      {/* NAVBAR */}
      <nav className="fixed top-0 w-full nav-glass z-50 h-20 px-6 flex items-center justify-between">
        <div onClick={()=>setCurrentView('home')} className="flex items-center gap-3 cursor-pointer">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{backgroundColor:config.primaryColor}}><Home className="text-white" size={20}/></div>
          <span className="font-cinzel font-black text-xl hidden md:block" style={{color:config.primaryColor}}>CHAUD.DEVANT</span>
          {/* Couronne plan + tokens */}
          {user && (
            <div className="hidden md:flex items-center gap-2">
              {/* Couronne plan */}
              {(() => {
                const isPro = isCurrentUserPremium();
                return (
                  <button
                    onClick={isPro ? undefined : ()=>setShowFreemiumModal(true)}
                    className={`p-1.5 rounded-full transition-all ${isPro ? 'cursor-default' : 'hover:bg-amber-50 cursor-pointer'}`}
                    title={isPro ? 'Premium ☕' : 'Passer Premium'}
                  >
                    <Crown size={18} className={isPro ? 'text-amber-400' : 'text-gray-300'} fill={isPro ? '#fbbf24' : 'none'}/>
                  </button>
                );
              })()}
              {/* Badge tokens cliquable */}
              {tokenBalance !== null && (
                <button
                  onClick={()=>setShowTokenShop(true)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border transition-all hover:scale-105 ${
                    tokenBalance > 200 ? 'bg-green-50 text-green-700 border-green-200' :
                    tokenBalance > 50  ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                         'bg-red-50 text-red-700 border-red-200 animate-pulse'
                  }`}
                  title="Mes tokens IA — cliquer pour recharger"
                >
                  <Flame size={11}/>
                  <span>{tokenBalance.toLocaleString('fr-FR')}</span>
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-4 items-center">
          <div className="hidden md:flex gap-6">
            {['home','hub','frigo','xsite','recipes','cooking','calendar','tasks','wallet'].map(v=>(
              <button key={v} onClick={()=>setCurrentView(v)} className="text-xs font-black tracking-widest opacity-40 hover:opacity-100 uppercase" style={{color:currentView===v?config.primaryColor:'inherit'}}>{config.navigationLabels[v as keyof typeof config.navigationLabels]||v}</button>
            ))}
          </div>
          {user && (
            <div className="md:hidden flex items-center gap-1.5">
              {/* Couronne mobile */}
              <button onClick={isCurrentUserPremium() ? undefined : ()=>setShowFreemiumModal(true)} className="p-1">
                <Crown size={15} className={isCurrentUserPremium() ? 'text-amber-400' : 'text-gray-300'} fill={isCurrentUserPremium() ? '#fbbf24' : 'none'}/>
              </button>
              {/* Tokens mobile cliquable */}
              {tokenBalance !== null && (
                <button
                  onClick={()=>setShowTokenShop(true)}
                  className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-black border ${
                    tokenBalance > 200 ? 'bg-green-50 text-green-700 border-green-200' :
                    tokenBalance > 50  ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                         'bg-red-50 text-red-700 border-red-200 animate-pulse'
                  }`}
                >
                  <Flame size={9}/>{tokenBalance.toLocaleString('fr-FR')}
                </button>
              )}
            </div>
          )}
<button
            onClick={()=>setShowCommPanel(true)}
            className="w-8 h-8 rounded-full border-2 border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-700 font-black text-sm flex items-center justify-center transition-all"
            title="Communication & Contact"
          >?</button>
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
        hidden={isMenuOpen||isNotifOpen||isEventModalOpen||isRecipeModalOpen||showFreemiumModal||wishlistModalOpen||showTokenShop||!!adminTokenUser}
      />

      <main className="max-w-7xl mx-auto px-3 md:px-6 pt-24 md:pt-28 pb-32 relative z-10">

        {/* ACCUEIL */}
        {currentView==='home'&&(
          isPageLocked('home') ? <MaintenancePage pageName="Accueil" isHome/> : (
          <div className="space-y-16 animate-in fade-in duration-1000" id="top">
            <section className="relative h-[45vh] md:h-[60vh] rounded-[2rem] md:rounded-[3rem] overflow-hidden glass-panel shadow-2xl group">
              <img src={config.welcomeImage} className="w-full h-full object-cover transition-transform duration-[10s] group-hover:scale-110"/>
              <div className="absolute inset-0 hero-overlay flex flex-col justify-end p-10">
                <h1 className="text-3xl md:text-8xl font-cinzel font-black text-white leading-none">{config.welcomeTitle}</h1>
                <p className="text-xl text-white/90 italic mt-4">{config.welcomeText}</p>
                <button onClick={()=>setCurrentView('hub')} className="mt-8 btn-ghost px-8 py-4 rounded-xl font-bold uppercase tracking-widest shadow-xl flex items-center gap-3 w-fit hover:scale-105 transition-transform"><LayoutDashboard/>Ouvrir le Tableau</button>
              </div>
            </section>
            {config.homeHtml&&(
              <section id="home-widget" className="glass-panel overflow-hidden mb-8 border-0">
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

        {/* Modal achat tokens */}
        {showTokenShop&&tokenBalance!==null&&(
          <TokenShopModal
            config={config}
            onClose={()=>setShowTokenShop(false)}
            balance={tokenBalance}
            isPremium={isCurrentUserPremium()}
            onRequestUpgrade={()=>{setShowTokenShop(false);setShowFreemiumModal(true);}}
          />
        )}

        {/* Modal admin tokens utilisateur */}
        {adminTokenUser&&(
          <TokenAdminModal
            config={config}
            user={adminTokenUser}
            onClose={()=>setAdminTokenUser(null)}
          />
        )}
	{/* PANEL COMMUNICATION */}
       		  {showCommPanel&&<CommPanel config={config} user={user} onClose={()=>setShowCommPanel(false)}/>}

        {/* HUB */}
        {currentView==='hub'&&(isPageLocked('hub')?<MaintenancePage pageName="Le Tableau"/>:(
          <HubView
            user={user} config={config} usersMapping={usersMapping}
            recipes={recipes}
            isPremium={isCurrentUserPremium()}
            onShowFreemium={()=>setShowFreemiumModal(true)}
            consumeTokens={consumeTokens}
            onAddRecipe={(r:any)=>addEntry('family_recipes',r)}
            onAddSemainier={(title:string)=>{
              const today=new Date();
              const dayName=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'][today.getDay()];
              const getWN=(d:Date)=>{const t=new Date(d.valueOf());const dn=(d.getDay()+6)%7;t.setDate(t.getDate()-dn+3);const ft=t.valueOf();t.setMonth(0,1);if(t.getDay()!==4)t.setMonth(0,1+((4-t.getDay())+7)%7);return 1+Math.ceil((ft-t.valueOf())/604800000);};
              const weekKey=`${today.getFullYear()}_W${String(getWN(today)).padStart(2,'0')}`;
              const semEntry={platName:title,participants:['G','P','V'],mealTime:'Soir',day:dayName,weekKey,updatedAt:new Date().toISOString()};
              setDoc(doc(db,`semainier_meals`,`${dayName}_Soir_${weekKey}`),semEntry);
              pousserVersGoogleCalendar(`🍽 ${title}`, new Date(new Date().setHours(19,0,0,0)).toISOString());
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
            <FrigoView user={user} config={config} isPremium={isCurrentUserPremium()} onShowFreemium={()=>setShowFreemiumModal(true)} consumeTokens={consumeTokens}/>
          </div>
          )
        )}

        {/* PORTE-MONNAIE */}
        {currentView==='wallet'&&(isPageLocked('wallet')?<MaintenancePage pageName="Porte-Monnaie"/>:<WalletView user={user} config={config}/>)}

        {/* WISHLIST */}
        {currentView==='wishlist'&&(
          isPageLocked('wishlist') ? <MaintenancePage pageName="WishLists"/> : (
          <div className="space-y-6" id="wishlist-top">
            <WishlistView user={user} config={config} siteUsers={siteUsers} onModalChange={setWishlistModalOpen} consumeTokens={consumeTokens}/>
          </div>
          )
        )}

        {/* TÂCHES */}
       {currentView==='tasks'&&(
  isPageLocked('tasks')
    ? <MaintenancePage pageName="Tâches"/>
    : <TasksChoresView config={config} myLetter={myLetter} choreStatus={choreStatus} toggleChore={toggleChore}/>
)}

        {/* CALENDRIER */}
        {currentView==='calendar'&&(isPageLocked('calendar') ? <MaintenancePage pageName="Calendrier"/> : (
          <CalendarView
            user={user}
            config={config}
            events={events}
            addEntry={addEntry}
            deleteItem={deleteItem}
            siteUsers={siteUsers}
          />
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
                          <div className="p-3 bg-white/35 rounded-full group-hover:bg-black group-hover:text-white transition-colors"><Map size={24}/></div>
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
          <div className="space-y-0 animate-in fade-in" id="recipes-list">
            <RecipeModal isOpen={isRecipeModalOpen} onClose={setIsRecipeModalOpen} config={config} currentRecipe={currentRecipe} setCurrentRecipe={setCurrentRecipe} updateEntry={updateEntry} addEntry={addEntry}/>

            {recipeView==='list' ? (
              /* ─── VUE LISTE (style MiamSteps) ─── */
              <div className="space-y-8">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-3xl md:text-4xl font-black tracking-tight" style={{color:config.primaryColor}}>Nos Recettes</h2>
                    <p className="text-gray-400 text-sm mt-1">Choisissez une recette et suivez le guide pas à pas</p>
                  </div>
                  {!isCurrentUserPremium()&&recipes.length>=15 ? (
                    <button onClick={()=>setShowFreemiumModal(true)} className="flex items-center gap-2 px-6 py-3 text-white rounded-2xl font-bold text-sm hover:scale-105 transition-transform shadow-lg" style={{backgroundColor:config.primaryColor}}>☕ Débloquer illimité</button>
                  ) : (
                    <button onClick={()=>{setCurrentRecipe(defaultRecipeState);setIsRecipeModalOpen(true);}} className="flex items-center gap-2 px-6 py-3 text-white rounded-2xl font-bold text-sm hover:scale-105 transition-transform shadow-lg" style={{backgroundColor:config.primaryColor}}>
                      <Plus size={18}/>Ajouter une recette
                      {!isCurrentUserPremium()&&<span className="text-xs opacity-70">({recipes.length}/15)</span>}
                    </button>
                  )}
                </div>
                {/* Filtres */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <input value={recipeFilter} onChange={e=>setRecipeFilter(e.target.value)} placeholder="🔍 Rechercher…" className="flex-1 p-3 rounded-xl border border-gray-200 bg-white outline-none text-sm font-bold"/>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {['all','entrée','plat','dessert','autre'].map(cat=>(
                      <button key={cat} onClick={()=>setRecipeCategory(cat)}
                        className={`shrink-0 px-4 py-2 rounded-xl text-xs font-bold border-2 transition-all ${recipeCategory===cat?'text-white border-current':'border-gray-200 text-gray-500 bg-white hover:bg-gray-50'}`}
                        style={recipeCategory===cat?{backgroundColor:config.primaryColor,borderColor:config.primaryColor}:{}}
                      >{cat==='all'?'Tous':cat.charAt(0).toUpperCase()+cat.slice(1)}</button>
                    ))}
                  </div>
                </div>
                {/* Grille recettes */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {(() => {
                    const filtered = recipes.filter((r:any)=>{
                      const matchCat = recipeCategory==='all' || r.category===recipeCategory;
                      const matchQ = !recipeFilter || r.title?.toLowerCase().includes(recipeFilter.toLowerCase()) || r.chef?.toLowerCase().includes(recipeFilter.toLowerCase());
                      return matchCat && matchQ;
                    });
                    if(filtered.length===0) return <p className="col-span-full text-center text-gray-400 py-16 italic">Aucune recette trouvée.</p>;
                    return filtered.map((r:any)=>{
                      const ings = typeof r.ingredients==='string' ? r.ingredients.split('\n').filter((i:string)=>i.trim()!=='') : (r.ingredients||[]);
                      return (
                        <div key={r.id} className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden border border-gray-100 group flex flex-col"
                          onClick={()=>{
                            const ingsArr = typeof r.ingredients==='string' ? r.ingredients.split('\n').filter((i:string)=>i.trim()!=='') : (r.ingredients||[]);
                            setReadingRecipe({...r, ingredients: ingsArr});
                            setRecipeView('read');
                          }}>
                          {/* Image ou couleur */}
                          <div className="h-44 overflow-hidden relative flex items-center justify-center" style={{backgroundColor:config.primaryColor+'22'}}>
                            {r.image
                              ? <img src={r.image} alt={r.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"/>
                              : <ChefHat className="opacity-20 w-20 h-20" style={{color:config.primaryColor}}/>
                            }
                            {r.cookTime&&<div className="absolute bottom-2 right-2 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-lg text-xs font-bold text-gray-700 flex items-center gap-1"><Clock size={11}/>{r.cookTime}</div>}
                            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={e=>{e.stopPropagation();addRecipeToHub(r);}} className="p-1.5 bg-white/90 rounded-full shadow text-orange-500 hover:scale-110 transition-transform"><ShoppingBag size={13}/></button>
                              <button onClick={e=>{e.stopPropagation();openEditRecipe(r);}} className="p-1.5 bg-white/90 rounded-full shadow text-blue-500 hover:scale-110 transition-transform"><Pencil size={13}/></button>
                              <button onClick={e=>{e.stopPropagation();deleteItem('family_recipes',r.id);}} className="p-1.5 bg-white/90 rounded-full shadow text-red-500 hover:scale-110 transition-transform"><Trash2 size={13}/></button>
                            </div>
                          </div>
                          <div className="p-5 flex flex-col flex-grow">
                            <h3 className="text-lg font-bold text-gray-800 mb-1 leading-tight group-hover:text-orange-600 transition-colors">{r.title}</h3>
                            {r.description&&<p className="text-gray-400 text-sm mb-3 line-clamp-2 flex-grow">{r.description}</p>}
                            <div className="flex items-center justify-between text-xs text-gray-400 mt-auto pt-3 border-t border-gray-100">
                              <div className="flex gap-3">
                                {r.chef&&<span className="flex items-center gap-1"><ChefHat size={13} className="text-orange-400"/>{r.chef}</span>}
                                {r.prepTime&&<span className="flex items-center gap-1"><Clock size={13} className="text-orange-400"/>{r.prepTime}</span>}
                                {r.servings&&<span className="flex items-center gap-1"><Users size={13} className="text-orange-400"/>{r.servings}p.</span>}
                              </div>
                              <span className="capitalize text-gray-300 text-[10px] font-bold uppercase">{r.category}</span>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            ) : (
              /* ─── VUE LECTURE PAS À PAS ─── */
              readingRecipe && <MiamStepsReader recipe={readingRecipe} config={config} onBack={()=>{setRecipeView('list');setReadingRecipe(null);}} onEdit={()=>{openEditRecipe(readingRecipe);setRecipeView('list');}}/>
            )}
          </div>
        ))}

        {/* SEMAINIER — intégré directement dans l'app */}
        {currentView==='cooking'&&(isPageLocked('cooking') ? <MaintenancePage pageName="Semainier"/> : (
          <div className="space-y-0 animate-in fade-in" id="cooking-frame">
            <div className="glass-panel overflow-hidden" style={{minHeight:'800px'}}>
              <SemainierView
                config={config}
                recipes={recipes}
                isPremium={isCurrentUserPremium()}
                onShowFreemium={()=>setShowFreemiumModal(true)}
                onOpenRecipe={(recipeId: string) => {
                  const found = recipes.find(r => r.id === recipeId);
                  if(found) {
                    const ingsArr = typeof found.ingredients==='string'
                      ? found.ingredients.split('\n').filter((i:string)=>i.trim()!=='')
                      : (found.ingredients||[]);
                    setReadingRecipe({...found, ingredients: ingsArr});
                    setRecipeView('read');
                    setCurrentView('recipes');
                  }
                }}
              />
            </div>
          </div>
        ))}
const GithubConfigPanel = ({ db }: { db: any }) => {
  const [cfg, setCfg] = useState({ owner:'', repo:'', branch:'main' });
  const [saved, setSaved] = useState(false);

  useEffect(()=>{
    getDoc(doc(db,'site_config','github')).then(snap=>{
      if(snap.exists()) setCfg(snap.data() as any);
    }).catch(()=>{});
  },[]);

  const save = async () => {
    await setDoc(doc(db,'site_config','github'), cfg);
    setSaved(true);
    setTimeout(()=>setSaved(false), 2500);
  };

  const rawBase = cfg.owner && cfg.repo
    ? `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch||'main'}/`
    : '';

  return (
    <div className="bg-blue-50/80 border border-blue-100 p-5 rounded-3xl space-y-3">
      <h4 className="font-black text-xs uppercase tracking-widest text-blue-600 flex items-center gap-2">
        <Link size={13}/> Assets GitHub — images & fichiers
      </h4>
      <p className="text-xs text-gray-500 leading-relaxed">
        Configurez votre dépôt pour que les XSites accèdent aux fichiers via{' '}
        <code className="bg-blue-100 px-1 rounded font-mono text-blue-700">XSite.asset("chemin/fichier.png")</code>.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <input
          value={cfg.owner}
          onChange={e=>setCfg(c=>({...c,owner:e.target.value}))}
          placeholder="Propriétaire (ex: gabriel)"
          className="p-2.5 rounded-xl border border-blue-200 bg-white text-sm font-bold outline-none"
        />
        <input
          value={cfg.repo}
          onChange={e=>setCfg(c=>({...c,repo:e.target.value}))}
          placeholder="Dépôt (ex: chaud-devant)"
          className="p-2.5 rounded-xl border border-blue-200 bg-white text-sm font-bold outline-none"
        />
        <input
          value={cfg.branch}
          onChange={e=>setCfg(c=>({...c,branch:e.target.value}))}
          placeholder="Branche (ex: main)"
          className="p-2.5 rounded-xl border border-blue-200 bg-white text-sm font-bold outline-none"
        />
      </div>
      {rawBase && (
        <div className="bg-white rounded-xl p-3 border border-blue-100 font-mono text-[11px] text-gray-500 break-all">
          Base URL : <span className="text-blue-600">{rawBase}</span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-xl font-bold text-xs hover:scale-105 transition-transform"
        >
          <Save size={13}/>{saved ? '✅ Sauvegardé' : 'Sauvegarder'}
        </button>
      </div>
      <details className="text-xs text-blue-500 cursor-pointer">
        <summary className="font-bold hover:text-blue-700">Voir les exemples d'utilisation</summary>
        <pre className="mt-2 bg-white border border-blue-100 rounded-xl p-3 overflow-x-auto text-[10px] text-gray-700">{`<!-- Image depuis le dépôt -->
<img id="logo">
<script>
  document.getElementById('logo').src = XSite.asset('src/assets/logo.png');
<\/script>

<!-- Ou via XSite.img() directement -->
<div id="container"></div>
<script>
  document.getElementById('container')
    .appendChild(XSite.img('public/images/banner.jpg', 'Bannière'));
<\/script>`}</pre>
      </details>
    </div>
  );
};

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
              onSetAdminTokenUser={setAdminTokenUser}
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
