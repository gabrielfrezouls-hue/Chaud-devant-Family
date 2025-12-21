import React, { useState, useEffect, useRef } from 'react';
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { 
  Lock, Menu, X, Home, BookHeart, UtensilsCrossed, 
  Calendar as CalIcon, Settings, Code, Sparkles, Send, 
  Image as ImageIcon, MessageSquare, ChevronRight, LogIn, Loader2, ShieldAlert
} from 'lucide-react';
import { JournalEntry, FamilyEvent, ViewType, SiteConfig, SiteVersion } from './types';
import { askAIArchitect, askAIChat } from './services/geminiService';
import Background from './components/Background';

// --- LISTE DE SÉCURITÉ ---
// Remplace par les emails de ta famille
const FAMILY_EMAILS = [
  "gabriel.frezouls@gmail.com",
  "valentin.frezouls@gmail.com"
];

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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsInitializing(false);
    });
    return () => unsubscribe();
  }, []);

  const isAuthorized = user && user.email && FAMILY_EMAILS.includes(user.email);

  useEffect(() => {
    if (!isAuthorized) return;
    const unsubConfig = onSnapshot(doc(db, 'site_config', 'main'), (d) => { if (d.exists()) setConfig(d.data() as SiteConfig); });
    const unsubJournal = onSnapshot(query(collection(db, 'family_journal'), orderBy('timestamp', 'desc')), (s) => setJournal(s.docs.map(d => ({ id: d.id, ...d.data() } as JournalEntry))));
    const unsubEvents = onSnapshot(collection(db, 'family_events'), (s) => setEvents(s.docs.map(d => ({ id: d.id, ...d.data() } as FamilyEvent))));
    return () => { unsubConfig(); unsubJournal(); unsubEvents(); };
  }, [user]);

  const handleLogin = async () => { try { await signInWithPopup(auth, googleProvider); } catch (e) { alert("Erreur connexion"); } };
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

  if (isInitializing) return <div className="min-h-screen flex items-center justify-center bg-[#f5ede7]"><Loader2 className="w-12 h-12 animate-spin text-[#a85c48]" /></div>;

  if (!user) return (
    <div className="fixed inset-0 flex flex-col items-center justify-center p-6 bg-[#f5ede7]">
      <Background color="#a85c48" />
      <div className="z-10 text-center space-y-8 animate-in fade-in zoom-in duration-700">
        <div className="mx-auto w-24 h-24 rounded-[2.5rem] flex items-center justify-center shadow-xl bg-[#a85c48]"><Sparkles className="text-white" size={48} /></div>
        <h1 className="text-4xl font-cinzel font-black tracking-widest text-[#a85c48]">CHAUD DEVANT</h1>
        <button onClick={handleLogin} className="bg-white text-black font-black py-4 px-8 rounded-2xl shadow-xl flex items-center gap-3"><LogIn size={24} /> Connexion Google</button>
      </div>
    </div>
  );

  if (!isAuthorized) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-red-50 text-center space-y-6">
      <ShieldAlert className="text-red-500 w-16 h-16" />
      <h2 className="text-2xl font-bold text-red-800">ACCÈS RESTREINT</h2>
      <p>Désolé {user.displayName}, ton email ({user.email}) n'est pas autorisé.</p>
      <button onClick={handleLogout} className="bg-red-500 text-white font-bold py-3 px-6 rounded-xl">Déconnexion</button>
    </div>
  );

  return (
    <div className="min-h-screen pb-24 md:pb-0 transition-colors duration-700" style={{ backgroundColor: config.backgroundColor, fontFamily: config.fontFamily }}>
      <Background color={config.primaryColor} />
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-xl border-b border-black/5 z-50 h-20 px-6 flex items-center justify-between">
        <div onClick={() => setCurrentView('home')} className="flex items-center gap-3 cursor-pointer">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ backgroundColor: config.primaryColor }}><Home className="text-white" size={20} /></div>
          <span className="font-cinzel font-black text-xl hidden md:block" style={{ color: config.primaryColor }}>CHAUD.DEVANT</span>
        </div>
        <div className="hidden md:flex gap-8">
           {['home','journal','cooking','calendar'].map(v => (
             <button key={v} onClick={() => setCurrentView(v as ViewType)} className="text-xs font-black tracking-widest opacity-40 hover:opacity-100 uppercase">{v}</button>
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
                <h1 className="text-5xl md:text-8xl font-cinzel font-black text-white">{config.welcomeTitle}</h1>
                <p className="text-xl text-white/90 italic">{config.welcomeText}</p>
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
             <h2 className="text-5xl font-cinzel font-black text-center">JOURNAL</h2>
             <div className="columns-1 md:columns-2 gap-8 space-y-8">
               {journal.map(j => (
                 <div key={j.id} className="break-inside-avoid bg-white/90 rounded-[2rem] overflow-hidden shadow-lg p-6 space-y-4">
                   {j.image && <img src={j.image} className="w-full h-64 object-cover rounded-xl" />}
                   <div><h3 className="text-2xl font-bold">{j.title}</h3><p className="text-xs opacity-50">{j.date} - {j.author}</p></div>
                   <p className="opacity-80">{j.content}</p>
                   <button onClick={() => deleteEntry(j.id)} className="text-red-400 text-xs">Supprimer</button>
                 </div>
               ))}
             </div>
          </div>
        )}
        {currentView === 'cooking' && <div className="bg-white/90 rounded-[3rem] h-[800px] shadow-xl overflow-hidden"><iframe srcDoc={config.cookingHtml} className="w-full h-full" /></div>}
        {currentView === 'calendar' && (
           <div className="max-w-3xl mx-auto space-y-6">
             {events.map(ev => (
               <div key={ev.id} className="flex items-center gap-6 p-6 bg-white rounded-2xl shadow-sm">
                 <div className="text-center font-bold text-xl" style={{color: config.primaryColor}}>{new Date(ev.date).toLocaleDateString()}</div>
                 <div className="flex-1 font-bold text-lg">{ev.title}</div>
                 <button onClick={() => removeEvent(ev.id)} className="text-red-400"><X size={20}/></button>
               </div>
             ))}
           </div>
        )}
        {currentView === 'edit' && (
          !isEditUnlocked ? (
            <div className="max-w-md mx-auto bg-white/80 p-10 rounded-[3rem] text-center space-y-6 shadow-xl">
              <Settings className="mx-auto animate-spin-slow" size={48} style={{ color: config.primaryColor }} />
              <h2 className="text-3xl font-cinzel font-bold">ADMINISTRATION</h2>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-4 rounded-xl border text-center" placeholder="Code secret" />
              <button onClick={unlockEdit} className="w-full py-4 text-white font-bold rounded-xl" style={{ backgroundColor: config.primaryColor }}>ENTRER</button>
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

const SideMenu = ({ config, isOpen, close, setView, logout }: any) => (
  <div className={`fixed inset-0 z-[60] ${isOpen ? '' : 'pointer-events-none'}`}>
    <div className={`absolute inset-0 bg-black/40 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0'}`} onClick={close} />
    <div className={`absolute right-0 top-0 bottom-0 w-80 bg-[#f5ede7] p-10 transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className="flex justify-between items-center mb-10">
        <span className="font-cinzel font-black text-xl" style={{ color: config.primaryColor }}>MENU</span>
        <button onClick={close}><X /></button>
      </div>
      <div className="space-y-4">
        {['home','journal','cooking','calendar','edit'].map(v => (
          <button key={v} onClick={() => { setView(v); close(); }} className="block w-full text-left p-4 hover:bg-black/5 rounded-xl uppercase font-bold text-xs tracking-widest">{v}</button>
        ))}
        <button onClick={logout} className="block w-full text-left p-4 text-red-500 font-bold text-xs tracking-widest mt-8">DÉCONNEXION</button>
      </div>
    </div>
  </div>
);

const BottomNav = ({ config, view, setView }: any) => (
  <div className="md:hidden fixed bottom-0 w-full h-20 bg-[#a85c48] flex justify-around items-center rounded-t-3xl z-40 text-white/50" style={{ backgroundColor: config.primaryColor }}>
    {[
      {id:'home', i:<Home size={20}/>}, {id:'journal', i:<BookHeart size={20}/>},
      {id:'cooking', i:<UtensilsCrossed size={20}/>}, {id:'calendar', i:<CalIcon size={20}/>},
      {id:'edit', i:<Settings size={20}/>}
    ].map(b => (
      <button key={b.id} onClick={() => setView(b.id)} className={`${view === b.id ? 'text-white -translate-y-2' : ''} transition-all`}>{b.i}</button>
    ))}
  </div>
);

const HomeCard = ({ icon, title, label, onClick, color }: any) => (
  <div onClick={onClick} className="bg-white/70 p-10 rounded-[3rem] cursor-pointer hover:scale-105 transition-transform shadow-lg">
    <div style={{ color }} className="mb-4">{icon}</div>
    <h3 className="text-3xl font-cinzel font-bold">{title}</h3>
    <p className="text-xs font-bold tracking-widest opacity-50 mt-2">{label}</p>
  </div>
);

const AdminPanel = ({ config, save, addJ, addE, arch, chat, prompt, setP, load, hist }: any) => {
  const [tab, setTab] = useState('ia');
  const [newJ, setNewJ] = useState({ title:'', author:'', content:'', image:'' });
  const [newE, setNewE] = useState({ title:'', date:'' });
  const [localC, setLocalC] = useState(config);
  const fileRef = useRef<HTMLInputElement>(null);
  
  const handleFile = (e: any, cb: any) => {
    const f = e.target.files[0];
    if(f) { const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(f); }
  };

  return (
    <div className="bg-white/90 p-8 rounded-[3rem] shadow-2xl min-h-[600px]">
      <div className="flex gap-4 overflow-x-auto mb-8 pb-2">
        {['ia','home','journal','events','code'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-6 py-3 rounded-xl font-bold text-xs uppercase ${tab===t ? 'bg-black text-white' : 'bg-gray-100'}`}>{t}</button>
        ))}
      </div>

      {tab === 'ia' && (
        <div className="space-y-6">
           <h3 className="text-2xl font-cinzel font-bold">IA ARCHITECTE & CHAT</h3>
           <textarea value={prompt} onChange={e => setP(e.target.value)} className="w-full p-4 rounded-2xl border h-32" placeholder="Demande à l'IA..." />
           <div className="flex gap-4">
             <button onClick={arch} disabled={load} className="flex-1 py-4 bg-black text-white rounded-xl font-bold">Modifier le Design</button>
             <button onClick={chat} disabled={load} className="flex-1 py-4 bg-blue-600 text-white rounded-xl font-bold">Discuter</button>
           </div>
           <div className="bg-gray-50 p-6 rounded-2xl h-48 overflow-y-auto space-y-4">
             {hist.map((h: any, i: number) => <div key={i} className={`p-3 rounded-xl text-sm ${h.role === 'user' ? 'bg-black text-white ml-auto w-fit' : 'bg-white border w-fit'}`}>{h.text}</div>)}
           </div>
        </div>
      )}

      {tab === 'home' && (
        <div className="space-y-4">
           <input value={localC.welcomeTitle} onChange={e => setLocalC({...localC, welcomeTitle: e.target.value})} className="w-full p-4 rounded-xl border" placeholder="Titre" />
           <textarea value={localC.welcomeText} onChange={e => setLocalC({...localC, welcomeText: e.target.value})} className="w-full p-4 rounded-xl border h-32" placeholder="Texte" />
           <button onClick={() => save(localC)} className="w-full py-4 bg-green-600 text-white rounded-xl font-bold">Sauvegarder</button>
        </div>
      )}

      {tab === 'journal' && (
        <div className="space-y-4">
           <input value={newJ.title} onChange={e => setNewJ({...newJ, title: e.target.value})} className="w-full p-4 rounded-xl border" placeholder="Titre" />
           <input value={newJ.author} onChange={e => setNewJ({...newJ, author: e.target.value})} className="w-full p-4 rounded-xl border" placeholder="Auteur" />
           <textarea value={newJ.content} onChange={e => setNewJ({...newJ, content: e.target.value})} className="w-full p-4 rounded-xl border h-32" placeholder="Histoire..." />
           <div onClick={() => fileRef.current?.click()} className="p-4 border-2 border-dashed rounded-xl text-center cursor-pointer">{newJ.image ? 'Image chargée !' : 'Ajouter une photo'}</div>
           <input type="file" ref={fileRef} className="hidden" onChange={e => handleFile(e, (b: string) => setNewJ({...newJ, image: b}))} />
           <button onClick={() => { addJ({...newJ, date: new Date().toLocaleDateString()}); alert('Publié !'); }} className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold">Publier</button>
        </div>
      )}
      
      {tab === 'events' && (
        <div className="space-y-4">
           <input type="date" value={newE.date} onChange={e => setNewE({...newE, date: e.target.value})} className="w-full p-4 rounded-xl border" />
           <input value={newE.title} onChange={e => setNewE({...newE, title: e.target.value})} className="w-full p-4 rounded-xl border" placeholder="Événement" />
           <button onClick={() => { addE(newE); alert('Ajouté'); }} className="w-full py-4 bg-purple-600 text-white rounded-xl font-bold">Ajouter Date</button>
        </div>
      )}

      {tab === 'code' && (
        <div className="space-y-4">
           <textarea value={localC.cookingHtml} onChange={e => setLocalC({...localC, cookingHtml: e.target.value})} className="w-full p-4 rounded-xl border h-64 font-mono text-xs" placeholder="Code HTML Cuisine" />
           <button onClick={() => save(localC)} className="w-full py-4 bg-black text-white rounded-xl font-bold">Sauvegarder Code</button>
        </div>
      )}
    </div>
  );
};

export default App;
