import React, { useState, useEffect, useRef } from 'react';
// IMPORTS FIREBASE
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';

// IMPORTS DESIGN
import { 
  Lock, Menu, X, Home, BookHeart, UtensilsCrossed, 
  Calendar as CalIcon, Settings, Plus, Trash2, Sparkles, Send, 
  Image as ImageIcon, Code, MessageSquare, ChevronRight, LogIn, Loader2, ShieldAlert
} from 'lucide-react';
import { JournalEntry, FamilyEvent, ViewType, SiteConfig, SiteVersion } from './types';
import { askAIArchitect, askAIChat } from './services/geminiService';
import Background from './components/Background';

// --- 🔒 SÉCURITÉ : LISTE DES INVITÉS ---
// AJOUTE ICI LES EMAILS AUTORISÉS
const FAMILY_EMAILS = [
  "gabriel.frezouls@gmail.com",
  "exemple.maman@gmail.com",
  "exemple.papa@gmail.com"
];

// CONFIG PAR DÉFAUT
const ORIGINAL_CONFIG: SiteConfig = {
  primaryColor: '#a85c48',
  backgroundColor: '#f5ede7',
  fontFamily: 'Inter',
  welcomeTitle: 'CHAUD DEVANT',
  welcomeText: "Bienvenue dans l'espace sacré de notre famille.",
  welcomeImage: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?q=80&w=2070&auto=format&fit=crop',
  navigationLabels: { home: 'ACCUEIL', journal: 'JOURNAL', cooking: 'CUISINE', calendar: 'CALENDRIER' },
  hiddenSections: [], homeHtml: '', cookingHtml: ''
};

const App: React.FC = () => {
  // --- ÉTAT ---
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  
  const [config, setConfig] = useState<SiteConfig>(ORIGINAL_CONFIG);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [versions, setVersions] = useState<SiteVersion[]>([]);

  const [currentView, setCurrentView] = useState<ViewType>('home');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditUnlocked, setIsEditUnlocked] = useState(false);
  const [password, setPassword] = useState('');

  const [aiPrompt, setAiPrompt] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: string, text: string }[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // 1. AUTHENTIFICATION
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsInitializing(false);
    });
    return () => unsubscribe();
  }, []);

  // Vérification : Est-ce que l'email est dans la liste ?
  const isAuthorized = user && user.email && FAMILY_EMAILS.includes(user.email);

  // 2. DATA (Seulement si autorisé)
  useEffect(() => {
    // SÉCURITÉ : On ne charge RIEN si l'utilisateur n'est pas autorisé
    if (!isAuthorized) return;

    const unsubConfig = onSnapshot(doc(db, 'site_config', 'main'), (d) => { if (d.exists()) setConfig(d.data() as SiteConfig); });
    const unsubJournal = onSnapshot(query(collection(db, 'family_journal'), orderBy('timestamp', 'desc')), (s) => setJournal(s.docs.map(d => ({ id: d.id, ...d.data() } as JournalEntry))));
    const unsubEvents = onSnapshot(collection(db, 'family_events'), (s) => setEvents(s.docs.map(d => ({ id: d.id, ...d.data() } as FamilyEvent))));
    
    return () => { unsubConfig(); unsubJournal(); unsubEvents(); };
  }, [user]); // Se relance si l'utilisateur change

  // --- ACTIONS ---
  const handleLogin = async () => { try { await signInWithPopup(auth, googleProvider); } catch (e) { alert("Erreur Auth"); } };
  const handleLogout = () => { signOut(auth); setIsEditUnlocked(false); setCurrentView('home'); };
  
  const saveConfig = async (c: SiteConfig) => { await setDoc(doc(db, 'site_config', 'main'), c); setConfig(c); };
  const addEntry = async (e: any) => { await addDoc(collection(db, 'family_journal'), { ...e, timestamp: serverTimestamp() }); };
  const deleteEntry = async (id: string) => { if(confirm("Supprimer ?")) await deleteDoc(doc(db, 'family_journal', id)); };
  const addEvent = async (e: any) => { await addDoc(collection(db, 'family_events'), e); };
  const removeEvent = async (id: string) => { await deleteDoc(doc(db, 'family_events', id)); };

  const unlockEdit = () => { if (password === '16.07.gabi.11') { setIsEditUnlocked(true); setPassword(''); } else alert("Code faux"); };
  
  const handleArchitect = async () => {
    if (!aiPrompt.trim()) return; setIsAiLoading(true);
    const newConfig = await askAIArchitect(aiPrompt, config);
    if (newConfig) await saveConfig({ ...config, ...newConfig });
    setIsAiLoading(false);
  };
  
  const handleChat = async () => {
    if (!aiPrompt.trim()) return;
    const newH = [...chatHistory, { role: 'user', text: aiPrompt }];
    setChatHistory(newH); setAiPrompt(''); setIsAiLoading(true);
    const rep = await askAIChat(newH);
    setChatHistory([...newH, { role: 'model', text: rep }]); setIsAiLoading(false);
  };

  // --- RENDU : GESTION DES ÉCRANS ---

  // A. CHARGEMENT
  if (isInitializing) return (
    <div className="min-h-screen flex items-center justify-center" style={{backgroundColor: ORIGINAL_CONFIG.backgroundColor}}>
      <Loader2 className="w-12 h-12 animate-spin" style={{color: ORIGINAL_CONFIG.primaryColor}} />
    </div>
  );

  // B. NON CONNECTÉ -> PAGE DE LOGIN
  if (!user) return (
    <div className="fixed inset-0 flex flex-col items-center justify-center p-6" style={{backgroundColor: ORIGINAL_CONFIG.backgroundColor}}>
      <Background color={ORIGINAL_CONFIG.primaryColor} />
      <div className="z-10 text-center space-y-8 animate-in fade-in zoom-in duration-700">
        <div className="mx-auto w-24 h-24 rounded-[2.5rem] flex items-center justify-center shadow-xl" style={{backgroundColor: ORIGINAL_CONFIG.primaryColor}}>
          <Sparkles className="text-white" size={48} />
        </div>
        <h1 className="text-4xl font-cinzel font-black tracking-widest" style={{color: ORIGINAL_CONFIG.primaryColor}}>CHAUD DEVANT</h1>
        <button onClick={handleLogin} className="bg-white text-black font-black py-4 px-8 rounded-2xl shadow-xl flex items-center gap-3 hover:scale-105 transition-transform">
          <LogIn size={24} /> Connexion Google
        </button>
      </div>
    </div>
  );

  // C. CONNECTÉ MAIS INTERDIT -> PAGE "STOP"
  if (!isAuthorized) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-red-50 text-center space-y-6">
      <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center animate-pulse">
        <ShieldAlert className="text-red-500 w-12 h-12" />
      </div>
      <h2 className="text-2xl font-bold text-red-800 font-cinzel">ACCÈS RESTREINT</h2>
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-100 max-w-sm">
        <p className="text-gray-600 mb-2">Désolé <strong>{user.displayName}</strong>,</p>
        <p className="text-gray-600">Ton email n'est pas sur la liste des invités de la famille.</p>
        <p className="text-xs font-mono text-gray-400 mt-4">{user.email}</p>
      </div>
      <button onClick={handleLogout} className="bg-red-500 text-white font-bold py-3 px-8 rounded-xl hover:bg-red-600 transition-colors">Déconnexion</button>
    </div>
  );

  // D. AUTORISÉ -> L'APPLICATION
  return (
    <div className="min-h-screen pb-24 md:pb-0 transition-colors duration-700" style={{ backgroundColor: config.backgroundColor, fontFamily: config.fontFamily }}>
      <Background color={config.primaryColor} />
      
      {/* NAVBAR */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-xl border-b border-black/5 z-50 h-20 px-6 flex items-center justify-between">
        <div onClick={() => setCurrentView('home')} className="flex items-center gap-3 cursor-pointer">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ backgroundColor: config.primaryColor }}><Home className="text-white" size={20} /></div>
          <span className="font-cinzel font-black text-xl hidden md:block" style={{ color: config.primaryColor }}>CHAUD.DEVANT</span>
        </div>
        <div className="hidden md:flex gap-8">
           {['home','journal','cooking','calendar'].map(v => (
             <button key={v} onClick={() => setCurrentView(v as ViewType)} className="text-xs font-black tracking-widest opacity-40 hover:opacity-100 uppercase" style={{ color: currentView === v ? config.primaryColor : 'inherit' }}>{config.navigationLabels[v as keyof typeof config.navigationLabels]}</button>
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
              <HomeCard icon={<BookHeart size={40}/>} title="Journal" label="Voir les souvenirs" onClick={() => setCurrentView('journal')} color={config.primaryColor} />
              <HomeCard icon={<UtensilsCrossed size={40}/>} title="Cuisine" label="Le semainier" onClick={() => setCurrentView('cooking')} color={config.primaryColor} />
            </div>
          </div>
        )}

        {currentView === 'journal' && (
          <div className="space-y-10">
             <h2 className="text-5xl font-cinzel font-black text-center" style={{ color: config.primaryColor }}>NOTRE JOURNAL</h2>
             <div className="columns-1 md:columns-2 gap-8 space-y-8">
               {journal.map(j => (
                 <div key={j.id} className="break-inside-avoid bg-white/90 rounded-[2rem] overflow-hidden shadow-lg p-8 space-y-4 border border-black/5">
                   {j.image && <img src={j.image} className="w-full h-64 object-cover rounded-xl shadow-inner" />}
                   <div><h3 className="text-2xl font-bold font-cinzel">{j.title}</h3><p className="text-[10px] uppercase tracking-widest opacity-50">{j.date} - {j.author}</p></div>
                   <p className="opacity-80 leading-relaxed">{j.content}</p>
                   {user.uid === config.primaryColor && <button onClick={() => deleteEntry(j.id)} className="text-red-400 text-xs">Supprimer</button>} 
                 </div>
               ))}
             </div>
          </div>
        )}

        {currentView === 'cooking' && (
           <div className="bg-white/90 rounded-[3rem] min-h-[800px] shadow-xl overflow-hidden border border-black/5">
             {config.cookingHtml ? <iframe srcDoc={config.cookingHtml} className="w-full min-h-[800px]" /> : <div className="p-20 text-center opacity-40">Code HTML non configuré</div>}
           </div>
        )}

        {currentView === 'calendar' && (
           <div className="max-w-3xl mx-auto space-y-6">
             {events.length === 0 && <div className="text-center opacity-40 py-20">Aucun événement</div>}
             {events.map(ev => (
               <div key={ev.id} className="flex items-center gap-6 p-6 bg-white rounded-2xl shadow-sm border border-black/5">
                 <div className="text-center font-bold text-xl w-16" style={{color: config.primaryColor}}>{new Date(ev.date).getDate()}<br/><span className="text-xs opacity-50">{new Date(ev.date).toLocaleDateString('fr-FR',{month:'short'})}</span></div>
                 <div className="flex-1 font-bold text-lg font-cinzel">{ev.title}</div>
                 <div className="text-xs uppercase tracking-widest opacity-40">{ev.type}</div>
                 <button onClick={() => removeEvent(ev.id)} className="text-red-400 p-2"><Trash2 size={16}/></button>
               </div>
             ))}
           </div>
        )}

        {currentView === 'edit' && (
          !isEditUnlocked ? (
            <div className="max-w-md mx-auto bg-white/80 p-10 rounded-[3rem] text-center space-y-8 shadow-xl border border-black/5 mt-20">
              <Settings className="mx-auto animate-spin-slow" size={48} style={{ color: config.primaryColor }} />
              <h2 className="text-3xl font-cinzel font-bold" style={{ color: config.primaryColor }}>ADMINISTRATION</h2>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-4 rounded-xl border text-center outline-none focus:ring-2" placeholder="Code secret" style={{ borderColor: config.primaryColor }} />
              <button onClick={unlockEdit} className="w-full py-4 text-white font-bold rounded-xl shadow-lg hover:opacity-90 transition-opacity" style={{ backgroundColor: config.primaryColor }}>ENTRER</button>
            </div>
          ) : (
            <AdminPanel 
              config={config} save={saveConfig} 
              addJ={addEntry} addE={addEvent} 
              arch={handleArchitect} chat={handleChat} 
              prompt={aiPrompt} setP={setAiPrompt} load={isAiLoading} hist={chatHistory} 
            />
          )
        )}
      </main>
    </div>
  );
};

// --- SOUS-COMPOSANTS ---

const SideMenu = ({ config, isOpen, close, setView, logout }: any) => (
  <div className={`fixed inset-0 z-[60] ${isOpen ? '' : 'pointer-events-none'}`}>
    <div className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`} onClick={close} />
    <div className={`absolute right-0 top-0 bottom-0 w-80 bg-[#f5ede7] p-10 transition-transform duration-300 shadow-2xl ${isOpen ? 'translate-x-0' : 'translate-x-full'}`} style={{ backgroundColor: config.backgroundColor }}>
      <div className="flex justify-between items-center mb-10">
        <span className="font-cinzel font-black text-xl" style={{ color: config.primaryColor }}>MENU</span>
        <button onClick={close}><X /></button>
      </div>
      <div className="space-y-4">
        {['home','journal','cooking','calendar','edit'].map(v => (
          <button key={v} onClick={() => { setView(v); close(); }} className="block w-full text-left p-4 hover:bg-black/5 rounded-xl uppercase font-bold text-xs tracking-widest transition-colors">
            {v === 'edit' ? 'ADMINISTRATION' : config.navigationLabels[v] || v}
          </button>
        ))}
        <div className="h-px bg-black/5 my-4"></div>
        <button onClick={logout} className="block w-full text-left p-4 text-red-500 font-bold text-xs tracking-widest hover:bg-red-50 rounded-xl">DÉCONNEXION</button>
      </div>
    </div>
  </div>
);

const BottomNav = ({ config, view, setView }: any) => (
  <div className="md:hidden fixed bottom-0 w-full h-24 flex justify-around items-center rounded-t-[2.5rem] z-40 text-white/50 px-4 pb-4 shadow-[0_-10px_40px_rgba(0,0,0,0.1)]" style={{ backgroundColor: config.primaryColor }}>
    {[
      {id:'home', i:<Home size={22}/>}, {id:'journal', i:<BookHeart size={22}/>},
      {id:'cooking', i:<UtensilsCrossed size={22}/>}, {id:'calendar', i:<CalIcon size={22}/>},
      {id:'edit', i:<Settings size={22}/>}
    ].map(b => (
      <button key={b.id} onClick={() => setView(b.id)} className={`p-2 transition-all duration-300 ${view === b.id ? 'text-white -translate-y-2 bg-white/20 rounded-xl' : ''}`}>{b.i}</button>
    ))}
  </div>
);

const HomeCard = ({ icon, title, label, onClick, color }: any) => (
  <div onClick={onClick} className="bg-white/70 backdrop-blur-md p-10 rounded-[3rem] cursor-pointer hover:scale-105 transition-transform shadow-lg border border-white/50 group">
    <div style={{ color }} className="mb-6 group-hover:scale-110 transition-transform">{icon}</div>
    <h3 className="text-3xl font-cinzel font-bold mb-2">{title}</h3>
    <p className="text-[10px] font-bold tracking-widest opacity-50 uppercase flex items-center gap-2">{label} <ChevronRight size={14}/></p>
  </div>
);

const AdminPanel = ({ config, save, addJ, addE, arch, chat, prompt, setP, load, hist }: any) => {
  const [tab, setTab] = useState('ia');
  const [newJ, setNewJ] = useState({ title:'', author:'', content:'', image:'' });
  const [newE, setNewE] = useState({ title:'', date:'', type:'other' });
  const [localC, setLocalC] = useState(config);
  const fileRef = useRef<HTMLInputElement>(null);
  
  // Update local config if prop changes
  useEffect(() => { setLocalC(config); }, [config]);
  
  const handleFile = (e: any, cb: any) => {
    const f = e.target.files[0];
    if(f) { const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(f); }
  };

  return (
    <div className="bg-white/90 backdrop-blur-xl p-8 md:p-12 rounded-[3.5rem] shadow-2xl min-h-[700px] border border-black/5">
      <div className="flex gap-2 overflow-x-auto mb-10 pb-4 no-scrollbar">
        {[
          {id:'ia', l:'IA', i:<Sparkles size={16}/>}, 
          {id:'home', l:'ACCUEIL', i:<Home size={16}/>},
          {id:'journal', l:'JOURNAL', i:<BookHeart size={16}/>},
          {id:'events', l:'AGENDA', i:<CalIcon size={16}/>},
          {id:'code', l:'CODE', i:<Code size={16}/>}
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-6 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest whitespace-nowrap transition-all ${tab===t.id ? 'text-white scale-105 shadow-lg' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`} style={{ backgroundColor: tab===t.id ? config.primaryColor : '' }}>{t.i} {t.l}</button>
        ))}
      </div>

      {tab === 'ia' && (
        <div className="space-y-8 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>ARCHITECTE & CHAT</h3>
           <textarea value={prompt} onChange={e => setP(e.target.value)} className="w-full p-6 rounded-3xl border border-gray-200 h-32 focus:ring-4 outline-none transition-all" placeholder="Ex: 'Met un thème sombre et doré' ou 'Dis bonjour'..." />
           <div className="flex flex-col md:flex-row gap-4">
             <button onClick={arch} disabled={load} className="flex-1 py-5 text-white rounded-2xl font-black text-sm tracking-widest uppercase shadow-xl hover:brightness-110 flex justify-center items-center gap-2" style={{ backgroundColor: config.primaryColor }}>{load ? <Loader2 className="animate-spin"/> : <Sparkles size={18}/>} Modifier le Design</button>
             <button onClick={chat} disabled={load} className="flex-1 py-5 bg-gray-800 text-white rounded-2xl font-black text-sm tracking-widest uppercase shadow-xl hover:bg-black flex justify-center items-center gap-2"><MessageSquare size={18}/> Discuter</button>
           </div>
           <div className="bg-gray-50 p-8 rounded-[2rem] h-64 overflow-y-auto space-y-4 border border-gray-100">
             {hist.map((h: any, i: number) => <div key={i} className={`p-4 rounded-2xl text-sm max-w-[85%] ${h.role === 'user' ? 'bg-gray-800 text-white ml-auto' : 'bg-white border text-gray-600'}`}>{h.text}</div>)}
           </div>
        </div>
      )}

      {tab === 'home' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>ACCUEIL</h3>
           <input value={localC.welcomeTitle} onChange={e => setLocalC({...localC, welcomeTitle: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200" placeholder="Titre principal" />
           <textarea value={localC.welcomeText} onChange={e => setLocalC({...localC, welcomeText: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200 h-32" placeholder="Texte de bienvenue" />
           <button onClick={() => save(localC)} className="w-full py-5 text-white rounded-2xl font-black shadow-xl hover:brightness-110 uppercase tracking-widest" style={{ backgroundColor: config.primaryColor }}>Sauvegarder</button>
        </div>
      )}

      {tab === 'journal' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>AJOUTER UN SOUVENIR</h3>
           <div className="grid md:grid-cols-2 gap-6">
             <div className="space-y-4">
               <input value={newJ.title} onChange={e => setNewJ({...newJ, title: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200" placeholder="Titre du souvenir" />
               <input value={newJ.author} onChange={e => setNewJ({...newJ, author: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200" placeholder="Auteur" />
               <textarea value={newJ.content} onChange={e => setNewJ({...newJ, content: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200 h-32" placeholder="Racontez l'histoire..." />
             </div>
             <div onClick={() => fileRef.current?.click()} className="border-2 border-dashed border-gray-200 rounded-[2.5rem] flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors h-full min-h-[200px] overflow-hidden relative">
               {newJ.image ? <img src={newJ.image} className="absolute inset-0 w-full h-full object-cover"/> : <><ImageIcon className="opacity-20 mb-4" size={48}/><span className="text-xs font-bold uppercase opacity-30">Photo</span></>}
               <input type="file" ref={fileRef} className="hidden" onChange={e => handleFile(e, (b: string) => setNewJ({...newJ, image: b}))} />
             </div>
           </div>
           <button onClick={() => { if(newJ.title){ addJ({...newJ, date: new Date().toLocaleDateString()}); setNewJ({title:'',author:'',content:'',image:''}); alert('Publié !'); } }} className="w-full py-5 text-white rounded-2xl font-black shadow-xl hover:brightness-110 uppercase tracking-widest" style={{ backgroundColor: config.primaryColor }}>Publier</button>
        </div>
      )}
      
      {tab === 'events' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>NOUVEL ÉVÉNEMENT</h3>
           <div className="flex gap-4">
             <input type="date" value={newE.date} onChange={e => setNewE({...newE, date: e.target.value})} className="w-1/3 p-5 rounded-2xl border border-gray-200" />
             <input value={newE.title} onChange={e => setNewE({...newE, title: e.target.value})} className="w-2/3 p-5 rounded-2xl border border-gray-200" placeholder="Anniversaire, Fête..." />
           </div>
           <button onClick={() => { if(newE.title && newE.date){ addE(newE); setNewE({title:'',date:'',type:'other'}); alert('Ajouté'); } }} className="w-full py-5 text-white rounded-2xl font-black shadow-xl hover:brightness-110 uppercase tracking-widest" style={{ backgroundColor: config.primaryColor }}>Ajouter au calendrier</button>
        </div>
      )}

      {tab === 'code' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>CODE HTML (SEMAINIER)</h3>
           <textarea value={localC.cookingHtml} onChange={e => setLocalC({...localC, cookingHtml: e.target.value})} className="w-full p-6 rounded-3xl border border-gray-200 h-64 font-mono text-xs text-gray-600" placeholder="Collez votre code HTML ici..." />
           <button onClick={() => save(localC)} className="w-full py-5 text-white rounded-2xl font-black shadow-xl hover:brightness-110 uppercase tracking-widest" style={{ backgroundColor: config.primaryColor }}>Sauvegarder le code</button>
        </div>
      )}
    </div>
  );
};

export default App;
