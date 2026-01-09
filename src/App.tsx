import React, { useState, useEffect, useRef } from 'react';
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { 
  Lock, Menu, X, Home, BookHeart, ChefHat, Wallet, PiggyBank,
  Calendar as CalIcon, Settings, Code, Sparkles, Send, History,
  MessageSquare, ChevronRight, LogIn, Loader2, ShieldAlert, RotateCcw, ArrowLeft, Trash2, Pencil, ClipboardList,
  CheckSquare, Square, CheckCircle2, Plus, Minus, Clock, Save, ToggleLeft, ToggleRight, Upload, Image as ImageIcon, Book, Download, TrendingUp, TrendingDown, Percent
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { JournalEntry, Recipe, FamilyEvent, ViewType, SiteConfig, SiteVersion } from './types';
import { askAIArchitect, askAIChat } from './services/geminiService';
import Background from './components/Background';
import RecipeCard from './components/RecipeCard';

// --- SÉCURITÉ : LISTE DES INVITÉS ---
const FAMILY_EMAILS = [
  "gabriel.frezouls@gmail.com",
  "o.frezouls@gmail.com",
  "eau.fraise.fils@gmail.com",
  "valentin.frezouls@gmail.com", 
  "frezouls.pauline@gmail.com",
  "eau.fraise.fille@gmail.com",
  "m.camillini57@gmail.com"
];

const USER_MAPPING: Record<string, string> = {
  "gabriel.frezouls@gmail.com": "G",
  "frezouls.pauline@gmail.com": "P",
  "valentin.frezouls@gmail.com": "V"
};

// --- CONFIGURATION PAR DÉFAUT ---
const ORIGINAL_CONFIG: SiteConfig = {
  primaryColor: '#a85c48',
  backgroundColor: '#f5ede7', // BEIGE SABLE
  fontFamily: 'Montserrat', // POLICE DEMANDÉE
  welcomeTitle: 'CHAUD DEVANT',
  welcomeText: "Bienvenue dans l'espace sacré de notre famille.",
  welcomeImage: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?q=80&w=2070&auto=format&fit=crop',
  navigationLabels: { home: 'ACCUEIL', journal: 'JOURNAL', cooking: 'SEMAINIER', recipes: 'RECETTES', calendar: 'CALENDRIER', tasks: 'TÂCHES', wallet: 'PORTE-MONNAIE' },
  homeHtml: '', cookingHtml: ''
};

// --- LOGIQUE DES TÂCHES ---
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

// --- COMPOSANTS INDÉPENDANTS ---

const TaskCell = ({ weekId, letter, label, isLocked, choreStatus, toggleChore, myLetter }: any) => {
  const isDone = choreStatus[weekId]?.[letter] || false;
  const canCheck = !isLocked && myLetter === letter; 
  return (
    <td className="p-4 text-center align-middle">
      <div className="flex flex-col items-center gap-2">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-sm ${
          isDone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}> {letter} </span>
        <button onClick={() => canCheck && toggleChore(weekId, letter)} disabled={!canCheck} className={`transition-transform active:scale-95 ${!canCheck && !isDone ? 'opacity-20 cursor-not-allowed' : ''}`} title={isLocked ? "Trop tôt pour cocher !" : ""}>
          {isDone ? <CheckSquare className="text-green-500" size={24} /> : (canCheck ? <Square className="text-green-500 hover:fill-green-50" size={24} /> : <Square className="text-gray-200" size={24} />)}
        </button>
      </div>
    </td>
  );
};

// --- NOUVEAU COMPOSANT : PORTE-MONNAIE ---
const WalletView = ({ user, config }: { user: User, config: SiteConfig }) => {
  const [activeTab, setActiveTab] = useState<'family' | 'personal'>('family');
  
  // États Dettes Familiales
  const [debts, setDebts] = useState<any[]>([]);
  const [newDebt, setNewDebt] = useState({ from: '', to: '', amount: '', interest: '', reason: '' });
  
  // États Tirelire Personnelle
  const [myWallet, setMyWallet] = useState<any>({ balance: 0, history: [], tasks: [] });
  const [walletAmount, setWalletAmount] = useState('');
  const [newTask, setNewTask] = useState('');

  // 1. Charger les données
  useEffect(() => {
    if (!user) return;
    
    // Dettes
    const qDebts = query(collection(db, 'family_debts'), orderBy('createdAt', 'desc'));
    const unsubDebts = onSnapshot(qDebts, (s) => setDebts(s.docs.map(d => ({id: d.id, ...d.data()}))));

    // Tirelire Perso
    const unsubWallet = onSnapshot(doc(db, 'user_wallets', user.email!), (s) => {
      if (s.exists()) setMyWallet(s.data());
      else setDoc(doc(db, 'user_wallets', user.email!), { balance: 0, history: [], tasks: [] });
    });

    return () => { unsubDebts(); unsubWallet(); };
  }, [user]);

  // 2. Logique Dettes
  const addDebt = async () => {
    if (!newDebt.from || !newDebt.to || !newDebt.amount) return alert("Remplissez les champs !");
    await addDoc(collection(db, 'family_debts'), {
      ...newDebt,
      amount: parseFloat(newDebt.amount),
      interest: parseFloat(newDebt.interest || '0'),
      createdAt: new Date().toISOString()
    });
    setNewDebt({ from: '', to: '', amount: '', interest: '', reason: '' });
  };

  const calculateDebt = (debt: any) => {
    if (!debt.interest || debt.interest === 0) return debt.amount;
    const start = new Date(debt.createdAt);
    const now = new Date();
    const days = Math.floor((now.getTime() - start.getTime()) / (1000 * 3600 * 24));
    // Calcul intérêt simple : Capital * (Taux/100) * (Jours/365)
    const interestAmount = debt.amount * (debt.interest / 100) * (days / 365);
    return (debt.amount + interestAmount).toFixed(2);
  };

  // 3. Logique Tirelire
  const updateBalance = async (type: 'add' | 'sub') => {
    const val = parseFloat(walletAmount);
    if (!val || val <= 0) return;
    
    const newBal = type === 'add' ? myWallet.balance + val : myWallet.balance - val;
    const entry = {
      date: new Date().toISOString(),
      amount: type === 'add' ? val : -val,
      newBalance: newBal,
      month: new Date().getMonth() // Pour filtrer
    };

    await updateDoc(doc(db, 'user_wallets', user.email!), {
      balance: newBal,
      history: [...(myWallet.history || []), entry]
    });
    setWalletAmount('');
  };

  const addWalletTask = async () => {
    if (!newTask) return;
    await updateDoc(doc(db, 'user_wallets', user.email!), {
      tasks: [...(myWallet.tasks || []), { id: Date.now(), text: newTask, done: false }]
    });
    setNewTask('');
  };

  const toggleWalletTask = async (taskId: number) => {
    const newTasks = myWallet.tasks.map((t: any) => t.id === taskId ? { ...t, done: !t.done } : t);
    await updateDoc(doc(db, 'user_wallets', user.email!), { tasks: newTasks });
  };

  const deleteWalletTask = async (taskId: number) => {
    const newTasks = myWallet.tasks.filter((t: any) => t.id !== taskId);
    await updateDoc(doc(db, 'user_wallets', user.email!), { tasks: newTasks });
  };

  // Filtrage Historique Mois en cours
  const currentMonth = new Date().getMonth();
  const currentMonthHistory = (myWallet.history || []).filter((h: any) => new Date(h.date).getMonth() === currentMonth);
  
  // Données Graphique
  const graphData = currentMonthHistory.map((h: any, i: number) => ({
    name: new Date(h.date).getDate(),
    solde: h.newBalance
  }));

  return (
    <div className="space-y-6 pb-20 animate-in fade-in">
      <div className="flex justify-center gap-4 mb-8">
        <button onClick={() => setActiveTab('family')} className={`px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${activeTab === 'family' ? 'bg-black text-white shadow-lg' : 'bg-white text-gray-400'}`}>
          <ShieldAlert className="inline mr-2 mb-1" size={16}/> Dettes Famille
        </button>
        <button onClick={() => setActiveTab('personal')} className={`px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${activeTab === 'personal' ? 'bg-black text-white shadow-lg' : 'bg-white text-gray-400'}`}>
          <PiggyBank className="inline mr-2 mb-1" size={16}/> Ma Tirelire
        </button>
      </div>

      {activeTab === 'family' ? (
        <div className="bg-white/80 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-xl border border-white space-y-8">
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
                 <div className="flex justify-between items-center mb-2">
                    <span className="font-cinzel font-bold text-xl">{d.from} <span className="text-gray-300 text-xs mx-1">DOIT À</span> {d.to}</span>
                    <span className="text-2xl font-black" style={{color: config.primaryColor}}>{calculateDebt(d)}€</span>
                 </div>
                 <div className="flex gap-4 text-[10px] font-bold uppercase text-gray-400">
                   <span>Initial: {d.amount}€</span>
                   {d.interest > 0 && <span className="text-orange-400 flex items-center"><Percent size={10} className="mr-1"/> Intérêt: {d.interest}%</span>}
                   <span>{new Date(d.createdAt).toLocaleDateString()}</span>
                 </div>
               </div>
             ))}
           </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          {/* GAUCHE: Compte & Actions */}
          <div className="lg:col-span-1 space-y-6">
             <div className="bg-black text-white p-8 rounded-[2.5rem] shadow-2xl text-center relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-full bg-white/5 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-20"></div>
               <p className="text-xs font-black uppercase tracking-[0.2em] opacity-50 mb-4">Mon Solde Actuel</p>
               <h2 className="text-6xl font-cinzel font-bold mb-8">{myWallet.balance?.toFixed(2)}€</h2>
               
               <div className="flex items-center gap-2 bg-white/10 p-2 rounded-2xl backdrop-blur-md">
                 <button onClick={() => updateBalance('sub')} className="p-4 bg-white/10 hover:bg-red-500 rounded-xl transition-colors"><Minus/></button>
                 <input type="number" value={walletAmount} onChange={e => setWalletAmount(e.target.value)} className="w-full bg-transparent text-center font-bold text-xl outline-none" placeholder="Montant..." />
                 <button onClick={() => updateBalance('add')} className="p-4 bg-white/10 hover:bg-green-500 rounded-xl transition-colors"><Plus/></button>
               </div>
             </div>

             <div className="bg-white p-6 rounded-[2rem] shadow-lg border border-gray-100">
               <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2"><ClipboardList size={14}/> Mes Tâches Financières</h3>
               <div className="flex gap-2 mb-4">
                 <input value={newTask} onChange={e => setNewTask(e.target.value)} placeholder="Ex: Rembourser Papa..." className="flex-1 bg-gray-50 rounded-xl px-3 text-sm font-bold outline-none" />
                 <button onClick={addWalletTask} className="p-2 bg-gray-200 rounded-xl"><Plus size={16}/></button>
               </div>
               <div className="space-y-2 max-h-40 overflow-y-auto">
                 {(myWallet.tasks || []).map((t: any) => (
                   <div key={t.id} className="flex items-center gap-3 group">
                     <button onClick={() => toggleWalletTask(t.id)}>{t.done ? <CheckCircle2 size={16} className="text-green-500"/> : <Square size={16} className="text-gray-300"/>}</button>
                     <span className={`text-sm font-bold flex-1 ${t.done ? 'line-through text-gray-300' : 'text-gray-600'}`}>{t.text}</span>
                     <button onClick={() => deleteWalletTask(t.id)} className="opacity-0 group-hover:opacity-100 text-red-300"><X size={14}/></button>
                   </div>
                 ))}
               </div>
             </div>
          </div>

          {/* DROITE: Graphique & Historique */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-gray-100 h-64">
               <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Évolution du Mois</h3>
               <ResponsiveContainer width="100%" height="85%">
                 <AreaChart data={graphData}>
                   <defs>
                     <linearGradient id="colorBal" x1="0" y1="0" x2="0" y2="1">
                       <stop offset="5%" stopColor={config.primaryColor} stopOpacity={0.3}/>
                       <stop offset="95%" stopColor={config.primaryColor} stopOpacity={0}/>
                     </linearGradient>
                   </defs>
                   <Tooltip contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}} />
                   <Area type="monotone" dataKey="solde" stroke={config.primaryColor} fillOpacity={1} fill="url(#colorBal)" strokeWidth={3} />
                 </AreaChart>
               </ResponsiveContainer>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-gray-100">
               <div className="flex justify-between items-center mb-6">
                 <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 flex items-center gap-2"><History size={14}/> Historique (Mois en cours)</h3>
                 <span className="text-[10px] font-bold bg-gray-100 px-3 py-1 rounded-full text-gray-500">{new Date().toLocaleString('default', { month: 'long' })}</span>
               </div>
               <div className="space-y-4 max-h-60 overflow-y-auto pr-2">
                 {currentMonthHistory.length === 0 && <div className="text-center text-gray-300 italic py-4">Aucun mouvement ce mois-ci</div>}
                 {currentMonthHistory.slice().reverse().map((h: any, i: number) => (
                   <div key={i} className="flex justify-between items-center p-3 bg-gray-50 rounded-2xl">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${h.amount > 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                          {h.amount > 0 ? <TrendingUp size={16}/> : <TrendingDown size={16}/>}
                        </div>
                        <div className="text-xs font-bold text-gray-400 uppercase">{new Date(h.date).toLocaleDateString()}</div>
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

// --- AUTRES MODALES (Event, Journal, Recipe) ... ---
const EventModal = ({ isOpen, onClose, config, addEntry, newEvent, setNewEvent }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl space-y-6 relative animate-in zoom-in-95 duration-300">
        <button onClick={() => onClose(false)} className="absolute top-6 right-6 text-gray-400 hover:text-black"><X size={24}/></button>
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-black mb-4"><CalIcon size={32} style={{ color: config.primaryColor }} /></div>
          <h3 className="text-2xl font-cinzel font-bold">Nouvel Événement</h3>
        </div>
        <div className="space-y-4">
          <div><label className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">Quoi ?</label><input value={newEvent.title} onChange={e => setNewEvent({...newEvent, title: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 text-lg font-bold outline-none focus:ring-2" placeholder="Anniversaire..." autoFocus style={{ '--tw-ring-color': config.primaryColor } as any} /></div>
          <div><label className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">Quand ?</label><input type="date" value={newEvent.date} onChange={e => setNewEvent({...newEvent, date: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none cursor-pointer" /></div>
          <div onClick={() => setNewEvent({...newEvent, isAllDay: !newEvent.isAllDay})} className="flex items-center justify-between p-4 rounded-xl border border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-3"><Clock size={20} className={newEvent.isAllDay ? "text-gray-300" : "text-black"} /><span className="font-bold text-sm">Toute la journée</span></div>
            {newEvent.isAllDay ? <ToggleRight size={32} className="text-green-500"/> : <ToggleLeft size={32} className="text-gray-300"/>}
          </div>
          {!newEvent.isAllDay && (
            <div className="animate-in slide-in-from-top-2"><label className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">À quelle heure ?</label><input type="text" value={newEvent.time} onChange={e => setNewEvent({...newEvent, time: e.target.value})} placeholder="Ex: 20h00, Midi..." className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none font-bold text-lg" /></div>
          )}
        </div>
        <button onClick={() => { if (newEvent.title && newEvent.date) { addEntry('family_events', { title: newEvent.title, date: newEvent.date, time: newEvent.isAllDay ? null : (newEvent.time || '') }); setNewEvent({ title: '', date: new Date().toISOString().split('T')[0], time: '', isAllDay: true }); onClose(false); } else { alert("Titre et date requis !"); } }} className="w-full py-4 rounded-xl font-black text-white uppercase tracking-widest shadow-lg transform active:scale-95 transition-all" style={{ backgroundColor: config.primaryColor }}>Ajouter au calendrier</button>
      </div>
    </div>
  );
};

const JournalModal = ({ isOpen, onClose, config, currentJournal, setCurrentJournal, updateEntry, addEntry }: any) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const handleFile = (e: any, callback: any) => {
    const f = e.target.files[0];
    if(f) { const r = new FileReader(); r.onload = () => callback(r.result); r.readAsDataURL(f); }
  };
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-2xl rounded-[2.5rem] p-8 shadow-2xl space-y-6 relative animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
        <button onClick={() => onClose(false)} className="absolute top-6 right-6 text-gray-400 hover:text-black"><X size={24}/></button>
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-black mb-4"><BookHeart size={32} style={{ color: config.primaryColor }} /></div>
          <h3 className="text-2xl font-cinzel font-bold">{currentJournal.id ? 'Modifier le Souvenir' : 'Nouveau Souvenir'}</h3>
        </div>
        <div className="space-y-4">
          <input value={currentJournal.title} onChange={e => setCurrentJournal({...currentJournal, title: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 text-xl font-bold outline-none focus:ring-2" placeholder="Titre du souvenir" autoFocus style={{ '--tw-ring-color': config.primaryColor } as any} />
          <input value={currentJournal.author} onChange={e => setCurrentJournal({...currentJournal, author: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none" placeholder="Auteur (ex: Maman)" />
          <div onClick={() => fileRef.current?.click()} className="p-6 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 flex flex-col items-center justify-center text-gray-400 gap-2">
            {currentJournal.image ? <div className="flex items-center gap-2 text-green-600 font-bold"><CheckCircle2/> Photo ajoutée !</div> : <><Upload size={24}/><span>Ajouter une photo</span></>}
          </div>
          <input type="file" ref={fileRef} className="hidden" onChange={e => handleFile(e, (b:string) => setCurrentJournal({...currentJournal, image: b}))} />
          <textarea value={currentJournal.content} onChange={e => setCurrentJournal({...currentJournal, content: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none h-40" placeholder="Racontez votre histoire..." />
        </div>
        <button onClick={() => { 
            if(currentJournal.title) {
                const journalToSave = { ...currentJournal };
                if (!journalToSave.date) journalToSave.date = new Date().toLocaleDateString();
                if (journalToSave.id) { updateEntry('family_journal', journalToSave.id, journalToSave); } 
                else { addEntry('family_journal', journalToSave); }
                onClose(false);
            } else { alert("Il faut au moins un titre !"); }
        }} className="w-full py-4 rounded-xl font-black text-white uppercase tracking-widest shadow-lg transform active:scale-95 transition-all" style={{ backgroundColor: config.primaryColor }}>Publier le souvenir</button>
      </div>
    </div>
  );
};

const RecipeModal = ({ isOpen, onClose, config, currentRecipe, setCurrentRecipe, updateEntry, addEntry }: any) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const handleFile = (e: any, callback: any) => {
    const f = e.target.files[0];
    if(f) { const r = new FileReader(); r.onload = () => callback(r.result); r.readAsDataURL(f); }
  };
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-2xl rounded-[2.5rem] p-8 shadow-2xl space-y-6 relative animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
        <button onClick={() => onClose(false)} className="absolute top-6 right-6 text-gray-400 hover:text-black"><X size={24}/></button>
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-black mb-4"><ChefHat size={32} style={{ color: config.primaryColor }} /></div>
          <h3 className="text-2xl font-cinzel font-bold">{currentRecipe.id ? 'Modifier la Recette' : 'Nouvelle Recette'}</h3>
        </div>
        <div className="space-y-4">
          <input value={currentRecipe.title} onChange={e => setCurrentRecipe({...currentRecipe, title: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 text-xl font-bold outline-none focus:ring-2" placeholder="Nom du plat (ex: Gratin Dauphinois)" autoFocus style={{ '--tw-ring-color': config.primaryColor } as any} />
          <div className="flex gap-4">
             <input value={currentRecipe.chef} onChange={e => setCurrentRecipe({...currentRecipe, chef: e.target.value})} className="flex-1 p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none" placeholder="Chef (ex: Papa)" />
             <select value={currentRecipe.category} onChange={e => setCurrentRecipe({...currentRecipe, category: e.target.value})} className="flex-1 p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none">
               <option value="entrée">Entrée</option><option value="plat">Plat</option><option value="dessert">Dessert</option><option value="autre">Autre</option>
             </select>
          </div>
          <div onClick={() => fileRef.current?.click()} className="p-6 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 flex flex-col items-center justify-center text-gray-400 gap-2">
            {currentRecipe.image ? <div className="flex items-center gap-2 text-green-600 font-bold"><CheckCircle2/> Photo ajoutée !</div> : <><Upload size={24}/><span>Ajouter une photo</span></>}
          </div>
          <input type="file" ref={fileRef} className="hidden" onChange={e => handleFile(e, (b:string) => setCurrentRecipe({...currentRecipe, image: b}))} />
          <button onClick={() => { 
              if(currentRecipe.title) {
                  const recipeToSave = { ...currentRecipe };
                  if (recipeToSave.id) { updateEntry('family_recipes', recipeToSave.id, recipeToSave); } 
                  else { addEntry('family_recipes', recipeToSave); }
                  onClose(false);
              } else { alert("Il faut au moins un titre !"); }
          }} className="w-full py-4 rounded-xl font-black text-white uppercase tracking-widest shadow-lg transform active:scale-95 transition-all" style={{ backgroundColor: config.primaryColor }}>Enregistrer la recette</button>
          <div className="grid md:grid-cols-2 gap-4">
            <textarea value={currentRecipe.ingredients} onChange={e => setCurrentRecipe({...currentRecipe, ingredients: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none h-40" placeholder="Ingrédients (un par ligne)..." />
            <textarea value={currentRecipe.steps} onChange={e => setCurrentRecipe({...currentRecipe, steps: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none h-40" placeholder="Étapes de préparation..." />
          </div>
        </div>
        <div className="h-10"></div>
      </div>
    </div>
  );
};

const SideMenu = ({ config, isOpen, close, setView, logout }: any) => (
  <div className={`fixed inset-0 z-[60] ${isOpen ? '' : 'pointer-events-none'}`}>
    <div className={`absolute inset-0 bg-black/40 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0'}`} onClick={close} />
    <div className={`absolute right-0 top-0 bottom-0 w-80 bg-[#f5ede7] p-10 transition-transform ${isOpen ? 'translate-x-0' : 'translate-x-full'}`} style={{ backgroundColor: config.backgroundColor }}>
      <button onClick={() => close(false)} className="mb-10"><X /></button>
      <div className="space-y-4">
        {['home','journal','recipes','cooking','calendar', 'tasks', 'wallet', 'edit'].map(v => (
          <button key={v} onClick={() => { setView(v); close(false); }} className="block w-full text-left p-4 hover:bg-black/5 rounded-xl uppercase font-bold text-xs tracking-widest">
            {v === 'edit' ? 'ADMINISTRATION' : config.navigationLabels[v] || v}
          </button>
        ))}
        <button onClick={logout} className="block w-full text-left p-4 text-red-500 font-bold text-xs tracking-widest mt-8">DÉCONNEXION</button>
      </div>
    </div>
  </div>
);

const BottomNav = ({ config, view, setView }: any) => (
  <div className="md:hidden fixed bottom-0 w-full h-24 flex justify-around items-center rounded-t-[2.5rem] z-40 text-white/50 px-4 pb-4 shadow-xl" style={{ backgroundColor: config.primaryColor }}>
    {[
      {id:'home', i:<Home size={22}/>}, 
      {id:'wallet', i:<Wallet size={22}/>},
      {id:'journal', i:<BookHeart size={22}/>},
      {id:'tasks', i:<ClipboardList size={22}/>},
      {id:'recipes', i:<ChefHat size={22}/>}
    ].map(b => <button key={b.id} onClick={() => setView(b.id)} className={`p-2 ${view === b.id ? 'text-white -translate-y-2 bg-white/20 rounded-xl' : ''}`}>{b.i}</button>)}
  </div>
);

const HomeCard = ({ icon, title, label, onClick, color }: any) => (
  <div onClick={onClick} className="bg-white/70 backdrop-blur-md p-10 rounded-[3rem] cursor-pointer hover:scale-105 transition-transform shadow-lg border border-white/50 group">
    <div style={{ color }} className="mb-6 group-hover:scale-110 transition-transform">{icon}</div>
    <h3 className="text-3xl font-cinzel font-bold mb-2">{title}</h3>
    <p className="text-[10px] font-bold tracking-widest opacity-50 uppercase flex items-center gap-2">{label} <ChevronRight size={14}/></p>
  </div>
);

// --- ADMIN PANEL ---
const AdminPanel = ({ config, save, add, del, upd, events, recipes, journal, versions, restore, arch, chat, prompt, setP, load, hist }: any) => {
  const [tab, setTab] = useState('arch');
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [tempVersionName, setTempVersionName] = useState('');
  const [localC, setLocalC] = useState(config);
  const [goldenTab, setGoldenTab] = useState<'journal' | 'recipes'>('journal');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedRecipes, setSelectedRecipes] = useState<string[]>([]);
  const [goldenOutput, setGoldenOutput] = useState('');
  
  useEffect(() => { setLocalC(config); }, [config]);
  const fileRef = useRef<HTMLInputElement>(null);
  const handleFile = (e: any, cb: any) => { const f = e.target.files[0]; if(f) { const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(f); }};
  const startEditVersion = (v: any) => { setEditingVersionId(v.id); setTempVersionName(v.name); };
  const saveVersionName = (id: string) => { upd('site_versions', id, { name: tempVersionName }); setEditingVersionId(null); };

  const generateGolden = async () => {
    setGoldenOutput("Génération en cours avec l'IA... (Patientez)");
    try {
        let userPrompt = "";
        if (goldenTab === 'journal') {
            if (!dateRange.start || !dateRange.end) { setGoldenOutput("Erreur: Dates manquantes"); return; }
            const relevantEntries = journal.filter((j: any) => true); 
            const context = relevantEntries.map((j:any) => `Date: ${j.date}\nAuteur: ${j.author}\nTitre: ${j.title}\nContenu: ${j.content}`).join('\n\n');
            userPrompt = `Tu es un écrivain familial. Voici les souvenirs de la famille entre le ${dateRange.start} et le ${dateRange.end}. Rédige une chronique chaleureuse et émouvante qui résume ces moments comme un chapitre de livre.\n\nSOURCE:\n${context}`;
        } else {
            if (selectedRecipes.length === 0) { setGoldenOutput("Erreur: Aucune recette sélectionnée"); return; }
            const selected = recipes.filter((r:any) => selectedRecipes.includes(r.id));
            const context = selected.map((r:any) => `Titre: ${r.title}\nChef: ${r.chef}\nIngrédients: ${r.ingredients}\nPréparation: ${r.steps}`).join('\n\n---RECETTE SUIVANTE---\n\n');
            userPrompt = `Tu es un éditeur culinaire. Voici une sélection de recettes de famille. Crée la structure textuelle d'un livre de cuisine : une belle introduction générale, un sommaire, puis pour chaque recette, une mise en page soignée et appétissante.\n\nRECETTES:\n${context}`;
        }
        const result = await askAIChat([{ role: 'user', text: userPrompt }]);
        setGoldenOutput(result);
    } catch (e) {
        setGoldenOutput("Erreur lors de la génération. Vérifiez la clé API.");
    }
  };

  const handleExportPDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return alert("Autorisez les pop-ups pour exporter le PDF");
    const title = goldenTab === 'journal' ? "Chronique Familiale" : "Les Recettes Familiales";
    const aiText = goldenOutput || "Préface|||Introduction";
    const [preface, intro] = aiText.split('|||');

    let itemsToPrint = [];
    if (goldenTab === 'journal') { itemsToPrint = journal.filter((j: any) => true); } 
    else { itemsToPrint = recipes.filter((r: any) => selectedRecipes.includes(r.id)); }

    let chefs = "Par la Famille";
    if(goldenTab === 'recipes') {
        const chefsList = Array.from(new Set(itemsToPrint.map((r:any) => r.chef).filter(Boolean)));
        if(chefsList.length > 0) chefs = "Par " + chefsList.join(', ');
    }

    let sommaireHtml = '<ul class="sommaire">';
    itemsToPrint.forEach((item: any, index: number) => {
        const pageNum = 3 + (index * 2); 
        sommaireHtml += `<li><span class="recipe-name">${item.title}</span> <span class="dots">................................................</span> <span class="page-num">${pageNum}</span></li>`;
    });
    sommaireHtml += '</ul>';

    let contentHtml = '';
    itemsToPrint.forEach((item: any) => {
        const ingredientsList = Array.isArray(item.ingredients) ? item.ingredients.map((i:string) => `<li>${i}</li>`).join('') : item.ingredients.split('\n').map((i:string) => `<li>${i}</li>`).join('');
        const stepsText = item.steps ? item.steps.replace(/\n/g, '<br/><br/>') : '';

        if (goldenTab === 'recipes') {
             contentHtml += `
                <div class="page-break"></div>
                <div class="page recipe-page-1">
                    <h2 class="recipe-title">${item.title}</h2>
                    <p class="recipe-meta">Occasion : Repas de famille &bull; Chef : ${item.chef || 'Inconnu'}</p>
                    ${item.image ? `<div class="recipe-img"><img src="${item.image}" /></div>` : '<div class="no-img">Pas de photo</div>'}
                    <div class="ingredients-box"><h3>Ingrédients</h3><ul>${ingredientsList}</ul></div>
                </div>
                <div class="page-break"></div>
                <div class="page recipe-page-2">
                    <h3 class="steps-title">Préparation</h3>
                    <div class="steps-text">${stepsText}</div>
                </div>
            `;
        } else {
             contentHtml += `
                <div class="page-break"></div>
                <div class="page">
                    <h2>${item.title}</h2>
                    <p class="meta">${item.date} - Par ${item.author}</p>
                    ${item.image ? `<div class="recipe-img"><img src="${item.image}" /></div>` : ''}
                    <div class="steps-text"><p>${item.content.replace(/\n/g, '<br/>')}</p></div>
                </div>
             `;
        }
    });

    const htmlContent = `
      <html>
        <head>
          <title>${title}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap');
            @page { size: A4; margin: 0; }
            body { font-family: 'Montserrat', sans-serif; margin: 0; padding: 0; background: #fff; color: #1a1a1a; }
            .page { width: 210mm; height: 296mm; padding: 20mm; box-sizing: border-box; position: relative; overflow: hidden; }
            .page-break { page-break-after: always; }
            h1, h2, h3, .recipe-name, .subtitle, .intro-title { font-family: 'Playfair Display', serif; }
            .cover-page { text-align: center; display: flex; flex-direction: column; justify-content: center; height: 100%; border: 20px solid #a85c48; }
            h1.main-title { font-size: 60px; color: #a85c48; margin: 0; line-height: 1; }
            p.subtitle { font-size: 24px; color: #555; margin-top: 20px; font-style: italic; }
            .preface-box { margin-top: 50px; font-style: italic; font-size: 14px; padding: 0 40px; color: #666; font-family: 'Playfair Display', serif; }
            .intro-title { font-size: 30px; color: #a85c48; border-bottom: 2px solid #a85c48; padding-bottom: 10px; margin-bottom: 20px; }
            .intro-text { text-align: justify; margin-bottom: 50px; line-height: 1.6; }
            .sommaire { list-style: none; padding: 0; }
            .sommaire li { display: flex; align-items: baseline; margin-bottom: 10px; font-size: 18px; }
            .recipe-name { font-weight: bold; }
            .dots { flex: 1; border-bottom: 1px dotted #ccc; margin: 0 10px; }
            .page-num { color: #a85c48; font-weight: bold; }
            .recipe-title { font-size: 42px; color: #a85c48; margin: 0 0 10px 0; text-align: center; }
            .recipe-meta { text-align: center; text-transform: uppercase; font-size: 10px; letter-spacing: 2px; color: #888; margin-bottom: 30px; }
            .recipe-img { width: 100%; height: 400px; overflow: hidden; border-radius: 4px; margin-bottom: 30px; }
            .recipe-img img { width: 100%; height: 100%; object-fit: cover; }
            .no-img { width: 100%; height: 200px; background: #eee; display: flex; align-items: center; justify-content: center; color: #aaa; margin-bottom: 30px; }
            .ingredients-box h3 { font-size: 24px; color: #a85c48; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
            .ingredients-box ul { column-count: 2; column-gap: 40px; }
            .ingredients-box li { margin-bottom: 8px; font-size: 14px; }
            .steps-title { font-size: 32px; color: #a85c48; text-align: center; margin-bottom: 40px; }
            .steps-text { font-size: 16px; line-height: 1.8; text-align: justify; padding: 0 20px; }
            @media print { body { background: none; } }
          </style>
        </head>
        <body>
          <div class="page cover-page">
             <h1 class="main-title">${title}</h1>
             <p class="subtitle">${chefs}</p>
             <div class="preface-box">${preface ? preface.replace(/\n/g, '<br/>') : ''}</div>
          </div>
          <div class="page-break"></div>
          <div class="page">
             <h2 class="intro-title">Introduction</h2>
             <div class="intro-text">${intro ? intro.replace(/\n/g, '<br/>') : ''}</div>
             <h2 class="intro-title">Sommaire</h2>
             ${sommaireHtml}
          </div>
          ${contentHtml}
          <script>window.onload = function() { window.print(); }</script>
        </body>
      </html>
    `;
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  return (
    <div className="bg-white/90 backdrop-blur-xl p-8 rounded-[3.5rem] shadow-2xl min-h-[700px] border border-black/5">
      <div className="flex gap-2 overflow-x-auto mb-10 pb-4 no-scrollbar">
        {[
          {id:'arch', l:'ARCHITECTE', i:<Sparkles size={16}/>}, 
          {id:'gold', l:"JOURNAL D'OR", i:<Book size={16}/>},
          {id:'chat', l:'MAJORDOME', i:<MessageSquare size={16}/>},
          {id:'home', l:'ACCUEIL', i:<Home size={16}/>},
          {id:'code', l:'CODE', i:<Code size={16}/>},
          {id:'history', l:'HISTORIQUE', i:<History size={16}/>}
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest whitespace-nowrap transition-all ${tab===t.id ? 'text-white scale-105 shadow-lg' : 'bg-gray-100 text-gray-400'}`} style={{ backgroundColor: tab===t.id ? config.primaryColor : '' }}>{t.i} {t.l}</button>
        ))}
      </div>

      {tab === 'arch' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>ARCHITECTE IA</h3>
           <textarea value={prompt} onChange={e => setP(e.target.value)} className="w-full p-6 rounded-3xl border border-gray-200 h-32 focus:ring-4 outline-none" placeholder="Ex: 'Met un thème sombre et doré'..." />
           <button onClick={arch} disabled={load} className="w-full py-5 text-white rounded-2xl font-black uppercase shadow-xl" style={{ backgroundColor: config.primaryColor }}>{load ? <Loader2 className="animate-spin mx-auto"/> : "Transformer le design"}</button>
        </div>
      )}

      {tab === 'gold' && (
        <div className="space-y-6 animate-in fade-in">
            <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>JOURNAL D'OR</h3>
            <div className="flex bg-gray-100 p-1 rounded-xl w-fit mx-auto mb-6">
                <button onClick={() => setGoldenTab('journal')} className={`px-6 py-2 rounded-lg text-xs font-bold uppercase transition-all ${goldenTab === 'journal' ? 'bg-white shadow-sm text-black' : 'text-gray-400'}`}>Chronique</button>
                <button onClick={() => setGoldenTab('recipes')} className={`px-6 py-2 rounded-lg text-xs font-bold uppercase transition-all ${goldenTab === 'recipes' ? 'bg-white shadow-sm text-black' : 'text-gray-400'}`}>Livre de Cuisine</button>
            </div>

            {goldenTab === 'journal' ? (
                <div className="space-y-4">
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="text-xs font-bold text-gray-400 ml-2">Début</label>
                            <input type="date" value={dateRange.start} onChange={e => setDateRange({...dateRange, start: e.target.value})} className="w-full p-4 rounded-2xl border border-gray-200" />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs font-bold text-gray-400 ml-2">Fin</label>
                            <input type="date" value={dateRange.end} onChange={e => setDateRange({...dateRange, end: e.target.value})} className="w-full p-4 rounded-2xl border border-gray-200" />
                        </div>
                    </div>
                    <button onClick={generateGolden} className="w-full py-4 text-white font-bold rounded-2xl uppercase shadow-lg hover:scale-[1.02] transition-transform" style={{ backgroundColor: config.primaryColor }}>
                        <Sparkles size={18} className="inline mr-2"/> Générer la Chronique
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="h-48 overflow-y-auto border border-gray-100 rounded-2xl p-2 space-y-1">
                        {recipes.map((r: any) => (
                            <div 
                                key={r.id} 
                                onClick={() => {
                                    setSelectedRecipes(prev => prev.includes(r.id) ? prev.filter(id => id !== r.id) : [...prev, r.id]);
                                }} 
                                className={`p-3 rounded-xl cursor-pointer flex items-center gap-3 transition-all border-2 ${
                                    selectedRecipes.includes(r.id) 
                                    ? 'bg-orange-50 border-[#a85c48]' 
                                    : 'border-transparent hover:bg-white/50'
                                }`}
                            >
                                <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${selectedRecipes.includes(r.id) ? 'bg-[#a85c48] border-[#a85c48]' : 'border-gray-300'}`}>
                                    {selectedRecipes.includes(r.id) && <CheckSquare size={12} className="text-white"/>}
                                </div>
                                <span className="text-sm font-bold">{r.title}</span>
                            </div>
                        ))}
                    </div>
                    <button onClick={generateGolden} className="w-full py-4 text-white font-bold rounded-2xl uppercase shadow-lg hover:scale-[1.02] transition-transform" style={{ backgroundColor: config.primaryColor }}>
                        <Sparkles size={18} className="inline mr-2"/> Créer le Livre
                    </button>
                </div>
            )}

            {goldenOutput && (
                <div className="animate-in slide-in-from-bottom-4 relative">
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-bold text-gray-400 ml-2 uppercase tracking-widest">Résultat (Généré par IA)</label>
                        <button onClick={handleExportPDF} className="flex items-center gap-2 text-xs font-bold uppercase text-white px-4 py-2 rounded-lg hover:scale-105 transition-transform" style={{ backgroundColor: config.primaryColor }}>
                            <Download size={14}/> Télécharger le Livre (PDF)
                        </button>
                    </div>
                    <textarea value={goldenOutput} readOnly className="w-full h-40 p-6 rounded-3xl border border-gray-200 bg-gray-50 font-serif leading-relaxed focus:outline-none" />
                </div>
            )}
        </div>
      )}

      {tab === 'chat' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>MAJORDOME IA</h3>
           <div className="bg-gray-50 p-6 rounded-[2rem] h-64 overflow-y-auto space-y-4 border border-gray-100">
             {hist.map((h: any, i: number) => <div key={i} className={`p-4 rounded-2xl text-sm max-w-[85%] ${h.role === 'user' ? 'bg-gray-800 text-white ml-auto' : 'bg-white border text-gray-600'}`}>{h.text}</div>)}
           </div>
           <div className="flex gap-2">
             <input value={prompt} onChange={e => setP(e.target.value)} className="flex-1 p-4 rounded-2xl border" placeholder="Message..." />
             <button onClick={chat} disabled={load} className="p-4 bg-black text-white rounded-2xl"><Send size={20}/></button>
           </div>
        </div>
      )}

      {tab === 'home' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>ACCUEIL</h3>
           <input value={localC.welcomeTitle} onChange={e => setLocalC({...localC, welcomeTitle: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200" placeholder="Titre principal" />
           <textarea value={localC.welcomeText} onChange={e => setLocalC({...localC, welcomeText: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200 h-24" placeholder="Texte de bienvenue" />
           <div onClick={() => fileRef.current?.click()} className="p-4 border-2 border-dashed rounded-2xl text-center cursor-pointer text-xs uppercase font-bold text-gray-400">Changer la photo d'accueil</div>
           <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e => handleFile(e, (b: string) => setLocalC({...localC, welcomeImage: b}))} />
           <textarea value={localC.homeHtml} onChange={e => setLocalC({...localC, homeHtml: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200 h-32 font-mono text-xs" placeholder="Code HTML/Widget pour l'accueil (Optionnel)" />
           <button onClick={() => { save(localC, true); alert("Accueil sauvegardé !"); }} className="w-full py-5 text-white rounded-2xl font-black shadow-xl uppercase" style={{ backgroundColor: config.primaryColor }}>Sauvegarder</button>
        </div>
      )}

      {tab === 'code' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>CODE SEMAINIER</h3>
           <textarea value={localC.cookingHtml} onChange={e => setLocalC({...localC, cookingHtml: e.target.value})} className="w-full p-6 rounded-3xl border border-gray-200 h-64 font-mono text-xs text-gray-600" placeholder="Code HTML iframe..." />
           <button onClick={() => save(localC, true)} className="w-full py-5 text-white rounded-2xl font-black shadow-xl uppercase" style={{ backgroundColor: config.primaryColor }}>Sauvegarder le code</button>
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>RESTAURATION</h3>
           <p className="opacity-60 text-sm">Gérez vos sauvegardes de design.</p>
           <div className="space-y-3 h-96 overflow-y-auto">
             {versions.map((v: SiteVersion) => (
               <div key={v.id} className="flex justify-between items-center p-5 bg-gray-50 rounded-2xl border border-gray-100 group">
                 <div className="flex-1">
                   {editingVersionId === v.id ? (
                     <div className="flex gap-2 mr-4">
                       <input value={tempVersionName} onChange={e => setTempVersionName(e.target.value)} className="flex-1 p-2 rounded-lg border border-gray-300 text-sm" autoFocus />
                       <button onClick={() => saveVersionName(v.id)} className="p-2 bg-green-100 text-green-600 rounded-lg"><Save size={16}/></button>
                       <button onClick={() => setEditingVersionId(null)} className="p-2 bg-red-100 text-red-600 rounded-lg"><X size={16}/></button>
                     </div>
                   ) : (
                     <div>
                       <div className="font-bold flex items-center gap-2">
                         {v.name}
                         <button onClick={() => startEditVersion(v)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-opacity"><Pencil size={12}/></button>
                       </div>
                       <div className="text-xs opacity-50">{new Date(v.date).toLocaleString()}</div>
                     </div>
                   )}
                 </div>
                 <div className="flex gap-2">
                   <button onClick={() => del('site_versions', v.id)} className="p-3 bg-white border border-red-100 text-red-400 rounded-xl hover:bg-red-500 hover:text-white transition-colors" title="Supprimer"><Trash2 size={18}/></button>
                   <button onClick={() => restore(v)} className="p-3 bg-white border border-gray-200 rounded-xl hover:bg-black hover:text-white transition-colors" title="Restaurer"><RotateCcw size={18}/></button>
                 </div>
               </div>
             ))}
           </div>
        </div>
      )}
    </div>
  );
};

// --- APP COMPONENT ---

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  
  // Données
  const [config, setConfig] = useState<SiteConfig>(ORIGINAL_CONFIG);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [versions, setVersions] = useState<SiteVersion[]>([]);
  const [choreStatus, setChoreStatus] = useState<Record<string, any>>({});

  // États Modales
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false); 
  const [isJournalModalOpen, setIsJournalModalOpen] = useState(false); 

  // Formulaires
  const [newEvent, setNewEvent] = useState({ title: '', date: new Date().toISOString().split('T')[0], time: '', isAllDay: true });
  
  const defaultRecipeState = { id: '', title: '', chef: '', ingredients: '', steps: '', category: 'plat', image: '' };
  const [currentRecipe, setCurrentRecipe] = useState<any>(defaultRecipeState);

  const defaultJournalState = { id: '', title: '', author: '', content: '', image: '', date: '' };
  const [currentJournal, setCurrentJournal] = useState<any>(defaultJournalState);

  const [currentView, setCurrentView] = useState<ViewType | 'wallet'>('home');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditUnlocked, setIsEditUnlocked] = useState(false);
  const [password, setPassword] = useState('');

  const [aiPrompt, setAiPrompt] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: string, text: string }[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // 1. AUTHENTIFICATION
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => { 
      setUser(u); 
      setIsInitializing(false); 
    });
    return () => unsubscribe();
  }, []);

  const isAuthorized = user && user.email && FAMILY_EMAILS.includes(user.email);
  const myLetter = user && user.email ? USER_MAPPING[user.email] : null;

  // 2. CHARGEMENT
  useEffect(() => {
    if (!isAuthorized) return;
    const ignoreError = (err: any) => { console.log("Info: ", err.code); };

    const unsubC = onSnapshot(doc(db, 'site_config', 'main'), (d) => { if (d.exists()) setConfig(d.data() as SiteConfig); }, ignoreError);
    const unsubJ = onSnapshot(query(collection(db, 'family_journal'), orderBy('timestamp', 'desc')), (s) => setJournal(s.docs.map(d => ({ ...d.data(), id: d.id } as JournalEntry))), ignoreError);
    const unsubR = onSnapshot(collection(db, 'family_recipes'), (s) => setRecipes(s.docs.map(d => ({ ...d.data(), id: d.id } as Recipe))), ignoreError);
    const unsubE = onSnapshot(collection(db, 'family_events'), (s) => {
      const rawEvents = s.docs.map(d => ({ ...d.data(), id: d.id } as FamilyEvent));
      rawEvents.sort((a, b) => a.date.localeCompare(b.date));
      setEvents(rawEvents);
    }, ignoreError);
    const unsubV = onSnapshot(query(collection(db, 'site_versions'), orderBy('date', 'desc')), (s) => setVersions(s.docs.map(d => ({ ...d.data(), id: d.id } as SiteVersion))), ignoreError);
    const unsubT = onSnapshot(collection(db, 'chores_status'), (s) => {
      const status: Record<string, any> = {};
      s.docs.forEach(doc => { status[doc.id] = doc.data(); });
      setChoreStatus(status);
    }, ignoreError);

    return () => { unsubC(); unsubJ(); unsubR(); unsubE(); unsubV(); unsubT(); };
  }, [user]);

  // ACTIONS
  const handleLogin = async () => { try { await signInWithPopup(auth, googleProvider); } catch (e) { alert("Erreur Auth"); } };
  const handleLogout = () => { signOut(auth); setIsEditUnlocked(false); setCurrentView('home'); };
  
  const saveConfig = async (c: SiteConfig, saveHistory = false) => { 
    try {
      await setDoc(doc(db, 'site_config', 'main'), c); 
      setConfig(c);
      if(saveHistory) await addDoc(collection(db, 'site_versions'), { name: `Sauvegarde`, date: new Date().toISOString(), config: c });
    } catch(e) { console.error(e); }
  };
  const restoreVersion = (v: SiteVersion) => { if(confirm(`Restaurer la version "${v.name}" ?`)) saveConfig(v.config, false); };
  
  const addEntry = async (col: string, data: any) => { 
    try { 
      const { id, ...cleanData } = data; 
      await addDoc(collection(db, col), { ...cleanData, timestamp: serverTimestamp() }); 
    } catch(e) { alert("Erreur ajout"); } 
  };

  const updateEntry = async (col: string, id: string, data: any) => { try { const { id: _, ...c } = data; await setDoc(doc(db, col, id), { ...c, timestamp: serverTimestamp() }, { merge: true }); alert("Sauvegardé"); } catch (e) { alert("Erreur"); } };
  
  const deleteItem = async (col: string, id: string) => { 
    if(!id) { alert("Erreur: ID introuvable. Rafraîchissez la page."); return; }
    if(confirm("Supprimer définitivement ?")) {
        try { await deleteDoc(doc(db, col, id)); } catch(e) { console.error(e); alert("Erreur suppression"); }
    }
  };

  const unlockEdit = () => { if (password === '16.07.gabi.11') { setIsEditUnlocked(true); setPassword(''); } else alert("Code faux"); };
  
  const toggleChore = async (weekId: string, letter: string) => {
    try {
      const currentStatus = choreStatus[weekId]?.[letter] || false;
      await setDoc(doc(db, 'chores_status', weekId), { [letter]: !currentStatus }, { merge: true });
    } catch (e) { console.error("Erreur coche", e); }
  };

  const openEditRecipe = (recipe: any) => {
    const ingredientsStr = Array.isArray(recipe.ingredients) ? recipe.ingredients.join('\n') : recipe.ingredients;
    const stepsStr = recipe.steps || recipe.instructions || '';
    setCurrentRecipe({ ...recipe, ingredients: ingredientsStr, steps: stepsStr });
    setIsRecipeModalOpen(true);
  };

  const openEditJournal = (entry: any) => {
    setCurrentJournal(entry);
    setIsJournalModalOpen(true);
  };

  const handleArchitect = async () => { if (!aiPrompt.trim()) return; setIsAiLoading(true); const n = await askAIArchitect(aiPrompt, config); if (n) await saveConfig({...config, ...n}, true); setIsAiLoading(false); };
  const handleChat = async () => { if (!aiPrompt.trim()) return; const h = [...chatHistory, {role:'user',text:aiPrompt}]; setChatHistory(h); setAiPrompt(''); setIsAiLoading(true); const r = await askAIChat(h); setChatHistory([...h, {role:'model',text:r}]); setIsAiLoading(false); };

  if (isInitializing) return <div className="min-h-screen flex items-center justify-center bg-[#f5ede7]"><Loader2 className="w-12 h-12 animate-spin text-[#a85c48]"/></div>;
  if (!user) return <div className="fixed inset-0 flex flex-col items-center justify-center p-6 bg-[#f5ede7]"><Background color={ORIGINAL_CONFIG.primaryColor} /><div className="z-10 text-center space-y-8 animate-in fade-in zoom-in duration-700"><div className="mx-auto w-24 h-24 rounded-[2.5rem] flex items-center justify-center shadow-xl bg-[#a85c48]"><Sparkles className="text-white" size={48} /></div><h1 className="text-4xl font-cinzel font-black tracking-widest text-[#a85c48]">CHAUD DEVANT</h1><button onClick={handleLogin} className="bg-white text-black font-black py-4 px-8 rounded-2xl shadow-xl flex items-center gap-3 hover:scale-105 transition-transform"><LogIn size={24} /> CONNEXION GOOGLE</button></div></div>;
  if (!isAuthorized) return <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-red-50 text-center space-y-8"><ShieldAlert className="text-red-500 w-20 h-20" /><h2 className="text-3xl font-bold text-red-800 font-cinzel">ACCÈS RESTREINT</h2><button onClick={handleLogout} className="px-6 py-4 bg-red-500 text-white font-bold rounded-2xl">Déconnexion</button></div>;

  return (
    <div className="min-h-screen pb-24 md:pb-0 transition-colors duration-700" style={{ backgroundColor: config.backgroundColor, fontFamily: config.fontFamily }}>
      <Background color={config.primaryColor} />
      
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-xl border-b border-black/5 z-50 h-20 px-6 flex items-center justify-between">
        <div onClick={() => setCurrentView('home')} className="flex items-center gap-3 cursor-pointer">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ backgroundColor: config.primaryColor }}><Home className="text-white" size={20} /></div>
          <span className="font-cinzel font-black text-xl hidden md:block" style={{ color: config.primaryColor }}>CHAUD.DEVANT</span>
        </div>
        <div className="hidden md:flex gap-6">
           {['home','journal','recipes','cooking','calendar', 'tasks', 'wallet'].map(v => (
             <button key={v} onClick={() => setCurrentView(v as ViewType)} className="text-xs font-black tracking-widest opacity-40 hover:opacity-100 uppercase" style={{ color: currentView === v ? config.primaryColor : 'inherit' }}>{config.navigationLabels[v as keyof typeof config.navigationLabels] || v}</button>
           ))}
           <button onClick={() => setIsMenuOpen(true)} style={{ color: config.primaryColor }}><Menu size={20}/></button>
        </div>
        <button className="md:hidden" onClick={() => setIsMenuOpen(true)} style={{ color: config.primaryColor }}><Menu size={28} /></button>
      </nav>

      <SideMenu config={config} isOpen={isMenuOpen} close={() => setIsMenuOpen(false)} setView={setCurrentView} logout={handleLogout} />
      <BottomNav config={config} view={currentView} setView={setCurrentView} />

      <main className="max-w-7xl mx-auto px-6 pt-28 pb-32 relative z-10">
        
        {currentView === 'home' && (
          <div className="space-y-16 animate-in fade-in duration-1000">
            <section className="relative h-[60vh] rounded-[3rem] overflow-hidden shadow-2xl group">
              <img src={config.welcomeImage} className="w-full h-full object-cover transition-transform duration-[10s] group-hover:scale-110" />
              <div className="absolute inset-0 bg-black/40 flex flex-col justify-end p-10">
                <h1 className="text-5xl md:text-8xl font-cinzel font-black text-white leading-none">{config.welcomeTitle}</h1>
                <p className="text-xl text-white/90 italic mt-4">{config.welcomeText}</p>
              </div>
            </section>
            {config.homeHtml && <section className="bg-white/50 rounded-[3rem] overflow-hidden shadow-xl"><iframe srcDoc={config.homeHtml} className="w-full h-[500px]" sandbox="allow-scripts" /></section>}
            <div className="grid md:grid-cols-2 gap-8">
              <HomeCard icon={<Wallet size={40}/>} title="Porte-Monnaie" label="Famille & Tirelire Perso" onClick={() => setCurrentView('wallet')} color={config.primaryColor} />
              <HomeCard icon={<ChefHat size={40}/>} title="Recettes" label="Nos petits plats" onClick={() => setCurrentView('recipes')} color={config.primaryColor} />
            </div>
          </div>
        )}

        {/* --- PORTE-MONNAIE --- */}
        {currentView === 'wallet' && (
           <WalletView user={user} config={config} />
        )}

        {/* --- TÂCHES --- */}
        {currentView === 'tasks' && (
          <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-8">
            <div className="text-center space-y-4">
              <h2 className="text-5xl font-cinzel font-black" style={{ color: config.primaryColor }}>TÂCHES MÉNAGÈRES</h2>
              <p className="text-gray-500 font-serif italic">
                {myLetter ? `Salut ${myLetter === 'G' ? 'Gabriel' : myLetter === 'P' ? 'Pauline' : 'Valentin'}, à l'attaque !` : "Connecte-toi avec ton compte perso pour participer."}
              </p>
            </div>
            <div className="bg-white/90 backdrop-blur-xl rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/50">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left" style={{ backgroundColor: config.primaryColor + '15' }}>
                      <th className="p-4 font-black uppercase text-xs tracking-widest text-gray-500 w-24">Weekend</th>
                      <th className="p-4 font-black uppercase text-xs tracking-widest text-center" style={{ color: config.primaryColor }}>Aspi Haut</th>
                      <th className="p-4 font-black uppercase text-xs tracking-widest text-center" style={{ color: config.primaryColor }}>Aspi Bas</th>
                      <th className="p-4 font-black uppercase text-xs tracking-widest text-center" style={{ color: config.primaryColor }}>Lav/Douche</th>
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
              <div className="p-6 bg-gray-50 text-center text-xs text-gray-400 uppercase tracking-widest border-t border-gray-100">
                G = Gabriel • P = Pauline • V = Valentin
              </div>
            </div>
          </div>
        )}

        {/* --- CALENDRIER --- */}
        {currentView === 'calendar' && (
           <div className="max-w-3xl mx-auto space-y-10">
             <div className="flex flex-col items-center gap-6">
                <h2 className="text-5xl font-cinzel font-black" style={{ color: config.primaryColor }}>CALENDRIER</h2>
                <button onClick={() => setIsEventModalOpen(true)} className="bg-black text-white px-8 py-4 rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform flex items-center gap-3 shadow-xl" style={{ backgroundColor: config.primaryColor }}>
                  <Plus size={20}/> Ajouter un événement
                </button>
             </div>
             <EventModal isOpen={isEventModalOpen} onClose={setIsEventModalOpen} config={config} addEntry={addEntry} newEvent={newEvent} setNewEvent={setNewEvent} />
             <div className="space-y-4">
               {events.map(ev => {
                 const cleanDate = ev.date.split('T')[0];
                 const dateObj = new Date(cleanDate);
                 return (
                   <div key={ev.id} className="flex items-center gap-6 p-6 bg-white rounded-2xl shadow-sm border border-black/5 hover:shadow-md transition-shadow group">
                     <div className="text-center w-16">
                       <div className="font-bold text-xl leading-none" style={{color: config.primaryColor}}>{dateObj.getDate()}</div>
                       <div className="text-[10px] uppercase font-bold text-gray-400">{dateObj.toLocaleString('fr-FR', { month: 'short' })}</div>
                     </div>
                     <div className="flex-1 border-l pl-6 border-gray-100">
                       <div className="font-bold text-lg font-cinzel text-gray-800">{ev.title}</div>
                       {ev.time && <div className="text-xs text-gray-400 flex items-center mt-1"><Clock size={10} className="mr-1"/> {ev.time}</div>}
                     </div>
                     <button onClick={() => deleteItem('family_events', ev.id)} className="opacity-0 group-hover:opacity-100 p-2 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all" title="Supprimer"><Trash2 size={16} /></button>
                   </div>
                 );
               })}
               {events.length === 0 && <div className="text-center text-gray-400 py-10 italic">Rien de prévu pour le moment...</div>}
             </div>
           </div>
        )}

        {/* --- JOURNAL AVEC MODALE ET ÉDITION --- */}
        {currentView === 'journal' && (
          <div className="space-y-10">
             <div className="flex flex-col items-center gap-6">
               <h2 className="text-5xl font-cinzel font-black text-center" style={{ color: config.primaryColor }}>JOURNAL</h2>
               <button onClick={() => { setCurrentJournal(defaultJournalState); setIsJournalModalOpen(true); }} className="bg-black text-white px-8 py-4 rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform flex items-center gap-3 shadow-xl" style={{ backgroundColor: config.primaryColor }}>
                  <Plus size={20}/> Ajouter un souvenir
               </button>
             </div>

             <JournalModal isOpen={isJournalModalOpen} onClose={setIsJournalModalOpen} config={config} currentJournal={currentJournal} setCurrentJournal={setCurrentJournal} updateEntry={updateEntry} addEntry={addEntry} />

             <div className="columns-1 md:columns-2 gap-8 space-y-8">
               {journal.map(j => (
                 <div key={j.id} className="break-inside-avoid bg-white/90 rounded-[2rem] p-8 space-y-4 border border-black/5 shadow-lg relative group">
                   <div className="absolute top-4 right-4 z-20 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEditJournal(j)} className="p-2 bg-white/90 rounded-full shadow-md text-blue-500 hover:scale-110 transition-transform"><Pencil size={16}/></button>
                      <button onClick={() => deleteItem('family_journal', j.id)} className="p-2 bg-white/90 rounded-full shadow-md text-red-500 hover:scale-110 transition-transform"><Trash2 size={16}/></button>
                   </div>
                   
                   {j.image && <img src={j.image} className="w-full h-64 object-cover rounded-xl" />}
                   <div><h3 className="text-2xl font-bold font-cinzel">{j.title}</h3><p className="text-[10px] uppercase">{j.date} - {j.author}</p></div>
                   <p className="opacity-80 leading-relaxed">{j.content}</p>
                 </div>
               ))}
             </div>
          </div>
        )}

        {/* --- RECETTES --- */}
        {currentView === 'recipes' && (
          <div className="space-y-10">
             <div className="flex flex-col items-center gap-6">
               <h2 className="text-5xl font-cinzel font-black text-center" style={{ color: config.primaryColor }}>RECETTES</h2>
               <button onClick={() => { setCurrentRecipe(defaultRecipeState); setIsRecipeModalOpen(true); }} className="bg-black text-white px-8 py-4 rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform flex items-center gap-3 shadow-xl" style={{ backgroundColor: config.primaryColor }}>
                  <Plus size={20}/> Ajouter une recette
               </button>
             </div>

             <RecipeModal isOpen={isRecipeModalOpen} onClose={setIsRecipeModalOpen} config={config} currentRecipe={currentRecipe} setCurrentRecipe={setCurrentRecipe} updateEntry={updateEntry} addEntry={addEntry} />

             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {recipes.length === 0 && <p className="text-center col-span-full opacity-50">Aucune recette pour le moment.</p>}
               {recipes.map((r: any) => (
                 <div key={r.id} className="relative group">
                   <div className="absolute top-4 right-4 z-20 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEditRecipe(r)} className="p-2 bg-white/90 rounded-full shadow-md text-blue-500 hover:scale-110 transition-transform"><Pencil size={16}/></button>
                      <button onClick={() => deleteItem('family_recipes', r.id)} className="p-2 bg-white/90 rounded-full shadow-md text-red-500 hover:scale-110 transition-transform"><Trash2 size={16}/></button>
                   </div>
                   
                   <RecipeCard 
                      recipe={{
                        ...r,
                        ingredients: typeof r.ingredients === 'string' ? r.ingredients.split('\n').filter((i:string) => i.trim() !== '') : r.ingredients,
                        instructions: r.steps || r.instructions
                      }} 
                   />
                 </div>
               ))}
             </div>
          </div>
        )}

        {currentView === 'cooking' && (
           <div className="bg-white/90 rounded-[3rem] min-h-[800px] shadow-xl overflow-hidden border border-black/5">
             {config.cookingHtml ? <iframe srcDoc={config.cookingHtml} className="w-full min-h-[800px]" /> : <div className="p-20 text-center opacity-40">Semainier non configuré</div>}
           </div>
        )}

        {currentView === 'edit' && (
          !isEditUnlocked ? (
            <div className="max-w-md mx-auto bg-white/80 p-10 rounded-[3rem] text-center space-y-8 shadow-xl mt-20">
              <Settings className="mx-auto animate-spin-slow" size={48} style={{ color: config.primaryColor }} />
              <h2 className="text-3xl font-cinzel font-bold" style={{ color: config.primaryColor }}>ADMINISTRATION</h2>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-4 rounded-xl border text-center outline-none" placeholder="Code secret" />
              <button onClick={unlockEdit} className="w-full py-4 text-white font-bold rounded-xl" style={{ backgroundColor: config.primaryColor }}>ENTRER</button>
            </div>
          ) : (
            <AdminPanel 
              config={config} save={saveConfig} 
              add={addEntry} 
              del={deleteItem} 
              upd={updateEntry}
              events={events} versions={versions} restore={restoreVersion}
              recipes={recipes}
              journal={journal}
              arch={handleArchitect} chat={handleChat} 
              prompt={aiPrompt} setP={setAiPrompt} load={isAiLoading} hist={chatHistory} 
            />
          )
        )}
      </main>
    </div>
  );
};

export default App;
