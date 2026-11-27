import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { AppProvider, createApi, useApp } from './app';
import { BottomNav } from './ui/parts';
import Login from './screens/Login';
import Today from './screens/Today';
import History from './screens/History';
import DailyLog from './screens/DailyLog';
import Queue from './screens/Queue';
import Farm from './screens/Farm';
import Settings from './screens/Settings';
import Feed from './screens/Feed';
import Health from './screens/Health';
import More from './screens/More';
import Placement from './screens/Placement';
import Weighing from './screens/Weighing';
import Catch from './screens/Catch';
import Events from './screens/Events';
import Money from './screens/Money';
import Handbook, { HandbookArticle } from './screens/Handbook';
import Ask from './screens/Ask';
import NormsEdit from './screens/NormsEdit';
import './styles.css';

registerSW({ immediate: true });

function Shell() {
  const { session } = useApp();
  if (!session) {
    return <Routes><Route path="/login" element={<Login />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes>;
  }
  const head = session.role === 'head';
  return (
    <div className={`shell${head ? ' wide' : ''}`}>
      <BottomNav />
      <div className="main">
        <Routes>
          <Route path="/today" element={<Today />} />
          <Route path="/history" element={<History />} />
          <Route path="/log/:hb/:day" element={<DailyLog />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/health" element={<Health />} />
          <Route path="/more" element={<More />} />
          <Route path="/placement" element={<Placement />} />
          <Route path="/weighing" element={<Weighing />} />
          <Route path="/catch" element={<Catch />} />
          <Route path="/handbook" element={<Handbook />} />
          <Route path="/handbook/:id" element={<HandbookArticle />} />
          <Route path="/ask" element={<Ask />} />
          {head && <Route path="/norms" element={<NormsEdit />} />}
          {head && <Route path="/events" element={<Events />} />}
          {head && <Route path="/money" element={<Money />} />}
          {head && <Route path="/farm" element={<Farm />} />}
          {head && <Route path="/settings" element={<Settings />} />}
          <Route path="*" element={<Navigate to={head ? '/farm' : '/today'} replace />} />
        </Routes>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider api={createApi()}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}><Shell /></BrowserRouter>
    </AppProvider>
  </StrictMode>,
);
