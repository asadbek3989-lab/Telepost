import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Bot, CalendarClock, Calendar, Lock, Sparkles, Radio } from 'lucide-react';
import type { Channel, Post, PostFull, SessionInfo } from '../shared/types';
import { api, ApiError, inTelegram, setToken, tgWebApp } from './lib/api';
import { PostCreator } from './components/PostCreator';
import { PostManager } from './components/PostManager';
import { PlanView } from './components/PlanView';
import { AnalyticsView } from './components/AnalyticsView';
import { ChannelsView } from './components/ChannelsView';
import { Spinner, inputCls } from './components/ui';

type Tab = 'create' | 'plan' | 'manage' | 'stats' | 'channels';
type Phase = 'loading' | 'login' | 'blocked' | 'ready';

const ACTIVE_KEY = 'tp_active_channel';

const Screen: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen flex items-center justify-center p-6 bg-[#0b1120]">
    <div className="w-full max-w-sm bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-2xl text-center space-y-4">{children}</div>
  </div>
);

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [blockMsg, setBlockMsg] = useState('');
  const [passwordLogin, setPasswordLogin] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);

  const [tab, setTab] = useState<Tab>('create');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeId, setActiveId] = useState<string>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [posts, setPosts] = useState<Post[]>([]);
  const [editPost, setEditPost] = useState<PostFull | null>(null);
  const [statsKey, setStatsKey] = useState(0);

  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const channel = channels.find((c) => c.id === activeId) || channels[0] || null;

  useEffect(() => {
    try {
      const tg = tgWebApp();
      tg?.ready();
      tg?.expand();
      tg?.setHeaderColor?.('#0f172a');
      tg?.setBackgroundColor?.('#0b1120');
    } catch {
      /* e'tiborsiz */
    }
  }, []);

  const boot = useCallback(async () => {
    try {
      const me = await api<{ user: SessionInfo }>('/me');
      setSession(me.user);
      setPhase('ready');
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 403) {
        setBlockMsg(e.message);
        setPhase('blocked');
        return;
      }
      if (e instanceof ApiError && e.status === 401) {
        if (inTelegram()) {
          setBlockMsg("Telegram imzosi tasdiqlanmadi. Ilovani bot orqali qayta oching.");
          setPhase('blocked');
          return;
        }
        try {
          const h = await api<{ passwordLogin: boolean }>('/health');
          setPasswordLogin(h.passwordLogin);
        } catch {
          /* e'tiborsiz */
        }
        setPhase('login');
        return;
      }
      setBlockMsg(e?.message || 'Serverga ulanib bo\'lmadi');
      setPhase('blocked');
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  const loadChannels = useCallback(async () => {
    try {
      const r = await api<{ channels: Channel[] }>('/channels');
      setChannels(r.channels);
      return r.channels;
    } catch {
      return [];
    }
  }, []);

  const loadPosts = useCallback(async () => {
    if (!channel) return setPosts([]);
    try {
      const r = await api<{ posts: Post[] }>(`/posts?channelId=${encodeURIComponent(channel.id)}`);
      setPosts(r.posts);
    } catch {
      /* keyingi urinishda */
    }
  }, [channel?.id]);

  useEffect(() => {
    if (phase === 'ready') void loadChannels();
  }, [phase, loadChannels]);

  useEffect(() => {
    if (phase !== 'ready' || !channel) return;
    void loadPosts();
    const t = setInterval(() => {
      if (!document.hidden) void loadPosts();
    }, 30_000);
    return () => clearInterval(t);
  }, [phase, channel?.id, loadPosts]);

  const select = (id: string) => {
    setActiveId(id);
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* e'tiborsiz */
    }
    setEditPost(null);
  };

  const refreshAll = async () => {
    await loadChannels();
    await loadPosts();
    setStatsKey((k) => k + 1);
  };

  const login = async () => {
    setPwBusy(true);
    setPwErr('');
    try {
      const r = await api<{ token: string }>('/auth/login', { body: { password: pw } });
      setToken(r.token);
      setPw('');
      setPhase('loading');
      await boot();
    } catch (e: any) {
      setPwErr(e?.message || 'Xatolik');
    } finally {
      setPwBusy(false);
    }
  };

  if (phase === 'loading')
    return (
      <Screen>
        <Spinner className="w-7 h-7 text-sky-400 mx-auto" />
        <p className="text-sm text-slate-400">Yuklanmoqda...</p>
      </Screen>
    );

  if (phase === 'blocked')
    return (
      <Screen>
        <Lock className="w-9 h-9 text-amber-400 mx-auto" />
        <h1 className="text-lg font-bold text-white">Kirish mumkin emas</h1>
        <p className="text-sm text-slate-300 break-words">{blockMsg}</p>
        <button onClick={() => { setPhase('loading'); void boot(); }} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-sm">Qayta urinish</button>
      </Screen>
    );

  if (phase === 'login')
    return (
      <Screen>
        <div className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-tr from-sky-400 via-blue-500 to-indigo-600 flex items-center justify-center"><Bot className="w-6 h-6 text-white" /></div>
        <h1 className="text-lg font-bold text-white">TelePost AI</h1>
        {passwordLogin ? (
          <>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login()} placeholder="Admin paroli" className={inputCls} autoFocus />
            {pwErr && <p className="text-xs text-red-300">{pwErr}</p>}
            <button onClick={login} disabled={pwBusy || !pw} className="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm disabled:opacity-50">{pwBusy ? 'Tekshirilmoqda...' : 'Kirish'}</button>
          </>
        ) : (
          <p className="text-sm text-slate-300">Bu ilovani Telegramdagi botingiz orqali oching (menyu tugmasi yoki /start).</p>
        )}
      </Screen>
    );

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'create', label: 'Post yaratish', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'plan', label: 'Kontent reja', icon: <CalendarClock className="w-4 h-4" /> },
    { id: 'manage', label: 'Reja va tarix', icon: <Calendar className="w-4 h-4" /> },
    { id: 'stats', label: 'Statistika', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'channels', label: 'Kanallar', icon: <Radio className="w-4 h-4" /> },
  ];
  const queued = posts.filter((p) => p.status === 'scheduled').length;
  const awaiting = posts.filter((p) => p.awaiting && p.status === 'draft').length;
  const showOnboarding = !channel;
  const effectiveTab: Tab = showOnboarding ? 'channels' : tab;

  return (
    <div className="min-h-screen bg-[#0b1120] text-slate-100 flex flex-col">
      <header className="sticky top-0 z-40 bg-[#0f172a]/95 backdrop-blur-md border-b border-slate-800/80 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-sky-400 via-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20 shrink-0"><Bot className="w-5 h-5" /></div>
            <div className="min-w-0">
              <h1 className="text-base font-extrabold text-white leading-tight">TelePost <span className="text-sky-400">AI</span></h1>
              {channels.length > 1 ? (
                <select value={channel?.id || ''} onChange={(e) => select(e.target.value)} className="bg-transparent text-xs text-slate-300 font-semibold focus:outline-none max-w-[200px] -ml-0.5">
                  {channels.map((c) => <option key={c.id} value={c.id} className="bg-slate-900">{c.title}</option>)}
                </select>
              ) : (
                <div className="text-xs text-slate-400 truncate">{channel ? channel.title : 'Kanal ulanmagan'}</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {awaiting > 0 && <button onClick={() => setTab('manage')} className="text-[11px] px-2.5 py-1.5 rounded-xl bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">🤖 {awaiting} tasdiq kutmoqda</button>}
            {queued > 0 && <button onClick={() => setTab('manage')} className="hidden sm:flex text-[11px] px-2.5 py-1.5 rounded-xl bg-sky-500/10 text-sky-300 border border-sky-500/30 font-semibold">⏱ {queued} navbatda</button>}
          </div>
        </div>
      </header>

      {!showOnboarding && (
        <nav className="bg-[#0f172a]/70 border-b border-slate-800/60 sticky top-[65px] z-30 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto py-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition ${
                  tab === t.id ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
                {t.id === 'manage' && queued > 0 && <span className="w-4 h-4 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black flex items-center justify-center">{queued}</span>}
              </button>
            ))}
          </div>
        </nav>
      )}

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-5">
        {effectiveTab === 'create' && channel && (
          <PostCreator
            channel={channel}
            editPost={editPost}
            onClearEdit={() => setEditPost(null)}
            onSaved={() => void refreshAll()}
            onGoManage={() => setTab('manage')}
          />
        )}
        {effectiveTab === 'plan' && channel && <PlanView channel={channel} onDone={() => void refreshAll()} onGoManage={() => setTab('manage')} />}
        {effectiveTab === 'manage' && channel && (
          <PostManager
            channel={channel}
            posts={posts}
            onRefresh={() => void refreshAll()}
            onEdit={(p) => {
              setEditPost(p);
              setTab('create');
            }}
          />
        )}
        {effectiveTab === 'stats' && channel && <AnalyticsView channel={channel} refreshKey={statsKey} />}
        {effectiveTab === 'channels' && session && (
          <ChannelsView
            channels={channels}
            session={session}
            onboarding={showOnboarding}
            onChanged={() => void refreshAll()}
            onSelect={(id) => {
              select(id);
            }}
            onLogout={() => {
              setSession(null);
              setPhase('loading');
              void boot();
            }}
          />
        )}
      </main>

      <footer className="border-t border-slate-800/80 bg-[#0a0f1d] py-3 text-center text-[11px] text-slate-500">TelePost AI • Gemini & Telegram Bot API</footer>
    </div>
  );
}
